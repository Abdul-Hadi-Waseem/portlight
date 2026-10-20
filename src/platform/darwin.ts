import { spawn } from 'node:child_process';
import { AdminOutcome, type Listener, type PlatformAdapter, type ProcessInfo, type ServiceJob } from '../core/types.js';
import {
  APPLE_LABEL_PREFIX,
  HOMEBREW_FORMULA_SAFE,
  HOMEBREW_LABEL_PREFIX,
  LSTART_TEXT_SAFE,
  OSASCRIPT_USER_CANCELLED,
  PS_FIELDS,
  ZOMBIE_STATE_PREFIX,
} from './constants.js';
import { formatLstart, mergeListeners, parseLsofCwd, parseLsofListeners, parseNetstatListeners, parsePs, parsePsComm } from './darwin-parse.js';
import { isLoginItemEnabled, setLoginItem } from './darwin-login.js';
import { domainTarget, findLaunchdJob, LaunchdDomain } from './darwin-launchd.js';
import { run, runChecked } from './exec.js';

/**
 * Two sources, merged: netstat sees every user's sockets but names only the process that opened
 * each one; lsof (without root) sees only our own processes, but lists every process sharing a
 * socket, e.g. the workers of a prefork server. Either alone can call a busy port free.
 */
async function listListeners(): Promise<Listener[]> {
  const [netstat, lsof] = await Promise.all([
    runChecked('netstat', ['-anv', '-p', 'tcp']),
    runChecked('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']),
  ]);
  return mergeListeners(parseNetstatListeners(netstat.stdout), parseLsofListeners(lsof.stdout));
}

async function getProcesses(pids: number[]): Promise<Map<number, ProcessInfo>> {
  const processes = new Map<number, ProcessInfo>();
  if (pids.length === 0) return processes;
  const pidList = [...new Set(pids)].join(',');

  const [ps, comm, cwd] = await Promise.all([
    runChecked('ps', ['-o', PS_FIELDS, '-p', pidList]),
    runChecked('ps', ['-o', 'pid=,comm=', '-p', pidList]),
    runChecked('lsof', ['-a', '-nP', '-p', pidList, '-d', 'cwd', '-F', 'n']),
  ]);
  const names = parsePsComm(comm.stdout);
  const cwds = parseLsofCwd(cwd.stdout);
  for (const row of parsePs(ps.stdout)) {
    processes.set(row.pid, { ...row, name: names.get(row.pid) ?? null, cwd: cwds.get(row.pid) ?? null });
  }
  return processes;
}

async function isRunning(pid: number): Promise<boolean> {
  const { stdout } = await runChecked('ps', ['-o', 'stat=', '-p', String(pid)]);
  const state = stdout.trim();
  return state !== '' && !state.startsWith(ZOMBIE_STATE_PREFIX);
}

async function openUrl(url: string): Promise<void> {
  await runChecked('open', [url]);
}

function copyText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.once('error', reject);
    child.once('close', () => resolve());
    child.stdin.end(text);
  });
}

/** Text is passed as argv to AppleScript, never spliced into the script, so names cannot inject code. */
function osascript(lines: string[], args: string[]) {
  return run('osascript', [...lines.flatMap((line) => ['-e', line]), '--', ...args]);
}

async function confirm(message: string, confirmLabel: string): Promise<boolean> {
  const { stdout, code } = await osascript(
    [
      'on run argv',
      'display dialog (item 1 of argv) with title "Portlight" buttons {"Cancel", item 2 of argv} default button 2 cancel button 1 with icon caution',
      'return button returned of result',
      'end run',
    ],
    [message, confirmLabel],
  );
  return code === 0 && stdout.trim() === confirmLabel;
}

async function notify(title: string, message: string): Promise<void> {
  await osascript(['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'], [title, message]);
}

function setStartAtLogin(item: { command: string[]; logFile: string } | null): void {
  setLoginItem(item ? { programArguments: item.command, path: process.env.PATH ?? '', logFile: item.logFile } : null);
}

/** Runs `command` as root after the standard macOS password dialog. Callers build it from validated parts only. */
async function runAsAdmin(command: string): Promise<{ outcome: AdminOutcome; message?: string }> {
  const { code, stderr } = await osascript(['on run argv', 'do shell script (item 1 of argv) with administrator privileges', 'end run'], [command]);
  if (code === 0) return { outcome: AdminOutcome.Done };
  if (stderr.includes(OSASCRIPT_USER_CANCELLED)) return { outcome: AdminOutcome.Cancelled };
  return { outcome: AdminOutcome.Failed, message: stderr.trim() };
}

async function findServiceJob(pid: number): Promise<ServiceJob | null> {
  const job = await findLaunchdJob(pid);
  if (!job) return null;
  if (job.label.startsWith(APPLE_LABEL_PREFIX)) return null;
  const formula = job.domain === LaunchdDomain.User && job.label.startsWith(HOMEBREW_LABEL_PREFIX) ? job.label.slice(HOMEBREW_LABEL_PREFIX.length) : null;
  const homebrewFormula = formula !== null && HOMEBREW_FORMULA_SAFE.test(formula) ? formula : null;
  return { label: job.label, needsAdmin: job.domain === LaunchdDomain.System, keepAlive: job.keepAlive, homebrewFormula };
}

/**
 * Stops a service the way its manager expects: `brew services stop` for Homebrew; otherwise
 * launchctl `bootout` when it would restart itself (KeepAlive), else a TERM through launchd.
 */
async function stopServiceJob(job: ServiceJob): Promise<{ outcome: AdminOutcome; message?: string }> {
  if (job.homebrewFormula) {
    const { code, stderr } = await run('brew', ['services', 'stop', job.homebrewFormula]);
    return code === 0 ? { outcome: AdminOutcome.Done } : { outcome: AdminOutcome.Failed, message: stderr.trim() };
  }
  const target = `${domainTarget(job.needsAdmin ? LaunchdDomain.System : LaunchdDomain.User)}/${job.label}`;
  const args = job.keepAlive ? ['bootout', target] : ['kill', 'TERM', target];
  if (job.needsAdmin) return runAsAdmin(['/bin/launchctl', ...args].join(' '));
  const { code, stderr } = await run('launchctl', args);
  return code === 0 ? { outcome: AdminOutcome.Done } : { outcome: AdminOutcome.Failed, message: stderr.trim() };
}

/**
 * The root command for adminTerminate, or null if its parts aren't safe. It signals only if, at
 * that moment, the pid still has the start time we checked: no window for pid reuse.
 */
export function adminTerminateCommand(pid: number, startedAt: Date): string | null {
  if (!Number.isInteger(pid) || pid <= 1 || Number.isNaN(startedAt.getTime())) return null;
  const lstart = formatLstart(startedAt);
  if (!LSTART_TEXT_SAFE.test(lstart)) return null;
  const current = `LC_ALL=C /bin/ps -o lstart= -p ${pid} | /usr/bin/tr -s ' ' | /usr/bin/sed 's/^ //;s/ $//'`;
  const changed = `{ echo 'process changed, not stopped' >&2; exit 1; }`;
  const killFailed = `{ echo 'kill failed' >&2; exit 1; }`;
  return `if [ "$(${current})" = '${lstart}' ]; then /bin/kill -TERM ${pid} || ${killFailed}; else ${changed}; fi`;
}

function adminTerminate(pid: number, startedAt: Date): Promise<{ outcome: AdminOutcome; message?: string }> {
  const command = adminTerminateCommand(pid, startedAt);
  if (!command) return Promise.resolve({ outcome: AdminOutcome.Failed, message: `refusing to build a command for pid ${pid}` });
  return runAsAdmin(command);
}

export const darwin: PlatformAdapter = {
  findServiceJob,
  stopServiceJob,
  adminTerminate,
  listListeners,
  getProcesses,
  isRunning,
  openUrl,
  copyText,
  confirm,
  notify,
  setStartAtLogin,
  isStartAtLogin: () => isLoginItemEnabled(),
};
