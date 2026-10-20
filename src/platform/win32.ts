import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stateDir } from '../core/paths.js';
import { AdminOutcome, type Listener, type PlatformAdapter, type ProcessInfo, type ServiceJob } from '../core/types.js';
import { WINDOWS_ISO_TIME_SAFE, WINDOWS_RUN_KEY, WINDOWS_RUN_VALUE, WINDOWS_SERVICE_NAME_SAFE } from './constants.js';
import { run } from './exec.js';
import { asRows, parseWinListeners, parseWinProcesses, type WinListenerRow, type WinProcessRow } from './win32-parse.js';
import {
  CONFIRM_SCRIPT,
  COPY_SCRIPT,
  ELEVATE_SCRIPT,
  ELEVATION_CANCELLED_EXIT,
  NOTIFY_SCRIPT,
  OPEN_URL_SCRIPT,
  PROCESS_CHANGED_EXIT,
  PROCESSES_SCRIPT,
  SCAN_SCRIPT,
  SERVICE_SCRIPT,
  stopServiceScript,
  terminateScript,
} from './win32-scripts.js';

/** PowerShell -EncodedCommand takes base64 of UTF-16LE: no quoting of the script at all. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function powershell(script: string, env: Record<string, string> = {}, timeoutMs?: number) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)], {
    env,
    timeoutMs,
  });
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text.trim() || '{}');
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// One PowerShell start per scan: listeners and their processes come back together, and
// getProcesses() right after listListeners() is answered from that same result.
const SCAN_REUSE_MS = 2000;
let lastScan: { at: number; processes: Map<number, ProcessInfo> } | null = null;

async function listListeners(): Promise<Listener[]> {
  const { stdout } = await powershell(SCAN_SCRIPT);
  const data = parseJson(stdout);
  const processes = parseWinProcesses(asRows<WinProcessRow>(data.processes));
  lastScan = { at: Date.now(), processes };
  const names = new Map([...processes].map(([pid, info]) => [pid, info.name ?? String(pid)]));
  return parseWinListeners(asRows<WinListenerRow>(data.listeners), names);
}

async function getProcesses(pids: number[]): Promise<Map<number, ProcessInfo>> {
  const wanted = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  if (wanted.length === 0) return new Map();
  if (lastScan && Date.now() - lastScan.at < SCAN_REUSE_MS && wanted.every((pid) => lastScan!.processes.has(pid))) {
    return new Map(wanted.map((pid) => [pid, lastScan!.processes.get(pid)!]));
  }
  const { stdout } = await powershell(PROCESSES_SCRIPT, { PL_PIDS: wanted.join(',') });
  return parseWinProcesses(asRows<WinProcessRow>(parseJson(stdout).processes));
}

/** Signal 0 checks existence without touching the process; Windows has no zombies. */
async function isRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function openUrl(url: string): Promise<void> {
  if (!/^http:\/\/localhost:\d{1,5}$/.test(url)) throw new Error(`Not a local URL: ${url}`);
  await powershell(OPEN_URL_SCRIPT, { PL_URL: url });
}

async function copyText(text: string): Promise<void> {
  await powershell(COPY_SCRIPT, { PL_TEXT: text });
}

async function confirm(message: string, confirmLabel: string): Promise<boolean> {
  // Windows' standard box has OK/Cancel, not custom labels: say what OK means.
  const { stdout } = await powershell(CONFIRM_SCRIPT, { PL_MESSAGE: `${message}\n\nOK = ${confirmLabel}` }, 10 * 60_000);
  return stdout.trim() === 'OK';
}

async function notify(title: string, message: string): Promise<void> {
  await powershell(NOTIFY_SCRIPT, { PL_TITLE: title, PL_MESSAGE: message });
}

/** Editors offered for "Open in…", with where each installs itself on Windows. */
function editorPaths(): Record<string, string[]> {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  return {
    Cursor: [path.join(local, 'Programs', 'cursor', 'Cursor.exe')],
    'Visual Studio Code': [path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(programFiles, 'Microsoft VS Code', 'Code.exe')],
    Windsurf: [path.join(local, 'Programs', 'Windsurf', 'Windsurf.exe')],
    Zed: [path.join(local, 'Programs', 'Zed', 'Zed.exe')],
  };
}

function editorExe(name: string): string | null {
  return editorPaths()[name]?.find((candidate) => existsSync(candidate)) ?? null;
}

function findEditor(preferred: string | null): string | null {
  if (preferred && editorExe(preferred)) return preferred;
  return Object.keys(editorPaths()).find((name) => editorExe(name) !== null) ?? null;
}

/** Explorer with the folder selected, or the editor on the folder. No shell: arguments stay arguments. */
async function openFolder(folder: string, app: string | null): Promise<void> {
  if (!path.win32.isAbsolute(folder)) throw new Error(`Not a folder path: ${folder}`);
  const exe = app ? editorExe(app) : 'explorer.exe';
  if (!exe) throw new Error(`${app} is not installed.`);
  const child = spawn(exe, app ? [folder] : [`/select,${folder}`], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
}

async function findServiceJob(pid: number): Promise<ServiceJob | null> {
  const { stdout } = await powershell(SERVICE_SCRIPT, { PL_PID: String(pid) });
  const name = parseJson(stdout).name;
  if (typeof name !== 'string' || !WINDOWS_SERVICE_NAME_SAFE.test(name)) return null;
  // Windows services run for the whole machine: stopping one always needs the admin prompt.
  return { label: name, needsAdmin: true, keepAlive: false, homebrewFormula: null };
}

/** Runs an elevated script (built only from validated parts) after the UAC prompt. */
async function runElevated(inner: string): Promise<{ outcome: AdminOutcome; message?: string }> {
  const { code, stderr } = await powershell(ELEVATE_SCRIPT, { PL_INNER: encodePowerShell(inner) }, 10 * 60_000);
  if (code === 0) return { outcome: AdminOutcome.Done };
  if (code === ELEVATION_CANCELLED_EXIT) return { outcome: AdminOutcome.Cancelled };
  if (code === PROCESS_CHANGED_EXIT) return { outcome: AdminOutcome.Failed, message: 'process changed, not stopped' };
  return { outcome: AdminOutcome.Failed, message: stderr.trim() || `exited ${code}` };
}

async function stopServiceJob(job: ServiceJob): Promise<{ outcome: AdminOutcome; message?: string }> {
  if (!WINDOWS_SERVICE_NAME_SAFE.test(job.label)) return { outcome: AdminOutcome.Failed, message: `unexpected service name ${job.label}` };
  return runElevated(stopServiceScript(job.label));
}

async function adminTerminate(pid: number, startedAt: Date): Promise<{ outcome: AdminOutcome; message?: string }> {
  const iso = Number.isNaN(startedAt.getTime()) ? '' : startedAt.toISOString();
  if (!Number.isInteger(pid) || pid <= 4 || !WINDOWS_ISO_TIME_SAFE.test(iso)) {
    return { outcome: AdminOutcome.Failed, message: `refusing to build a command for pid ${pid}` };
  }
  return runElevated(terminateScript(pid, iso));
}

/**
 * Start at login: a Run entry pointing at a tiny .vbs launcher, because node.exe started straight
 * from the registry would open a console window at every login.
 */
function launcherFile(): string {
  return path.join(stateDir(), 'start-tray.vbs');
}

function vbsQuote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function setStartAtLogin(item: { command: string[]; logFile: string } | null): void {
  if (!item) {
    run('reg', ['delete', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE, '/f']).catch(() => undefined);
    rmSync(launcherFile(), { force: true });
    return;
  }
  // WScript.Shell.Run gets one command string: each argument quoted, quotes doubled for VBScript.
  const commandLine = item.command.map((arg) => `""${arg}""`).join(' ');
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(launcherFile(), `CreateObject("WScript.Shell").Run "${commandLine}", 0, False\r\n`);
  execFileSync('reg', ['add', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE, '/t', 'REG_SZ', '/d', `wscript.exe ${vbsQuote(launcherFile())}`, '/f'], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

function isStartAtLogin(): boolean {
  try {
    execFileSync('reg', ['query', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE], { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export const win32: PlatformAdapter = {
  gracefulStop: false,
  listListeners,
  getProcesses,
  isRunning,
  openUrl,
  copyText,
  confirm,
  notify,
  openFolder,
  findEditor,
  findServiceJob,
  stopServiceJob,
  adminTerminate,
  setStartAtLogin,
  isStartAtLogin,
};

