import { createInterface } from 'node:readline/promises';
import { ExitCode, LOCALHOST, Signal } from '../core/constants.js';
import { portHolders } from '../core/port-check.js';
import { isPortBindable } from '../core/probe.js';
import { checkAll } from '../core/health.js';
import { currentUser, nameParts, reachOf, scan, displayName } from '../core/scan.js';
import { groupServers, isPrimary } from '../core/sections.js';
import { needsPassword, stopKey, stopRefusal, stopTarget } from '../core/stop-target.js';
import { Health, Reach, StopOutcome, type PlatformAdapter, type Server, type StopResult } from '../core/types.js';
import { clearTrayPid, recordSelf, runningTrayPid, setTrayAtLogin, startTrayInBackground } from '../tray/daemon.js';
import { runTray } from '../tray/tray.js';
import { LoginSetting, STATUS_DOT } from './constants.js';
import { safeText } from '../core/format.js';
import { formatBytes, formatDuration, link, paint, shortenHome, table } from './format.js';

export interface ListOptions {
  all: boolean;
  json: boolean;
}

export interface StopCommandOptions {
  yes: boolean;
}

const HEALTH_DOT: Record<Health, string> = {
  [Health.Up]: paint('green', STATUS_DOT),
  [Health.NotHttp]: paint('dim', STATUS_DOT),
  [Health.Down]: paint('red', STATUS_DOT),
};

const WIDE_HEADER = ['', 'NAME', '', 'PORT', 'PID', 'CPU', 'MEM', 'UP', 'REACH', 'FOLDER'];

function portCell(server: Server, health: Health | undefined): string {
  const port = paint('cyan', `:${server.port}`);
  return health === Health.Up ? link(`http://${LOCALHOST}:${server.port}`, port) : port;
}

/** Default row: what it is, where, and anything unusual. Quiet by default; dim for secondary facts. */
function serverRow(server: Server, health: Health | undefined, now: number): string[] {
  const { name, detail } = nameParts(server);
  const network = reachOf(server.addresses) === Reach.Network;
  // A container's memory, uptime and folder would be the runtime's: show its image instead.
  const container = server.container;
  return [
    health ? HEALTH_DOT[health] : paint('dim', '·'),
    paint('bold', name),
    paint('dim', detail ?? ''),
    portCell(server, health),
    paint('dim', container ? '' : formatBytes(server.memoryBytes)),
    paint('dim', !container && server.startedAt ? formatDuration(now - server.startedAt.getTime()) : ''),
    network ? paint('yellow', Reach.Network) : '',
    paint('dim', container ? safeText(container.image) : server.cwd ? shortenHome(server.cwd) : ''),
  ];
}

/** --all row: every column, for when you need the PID or CPU. */
function wideRow(server: Server, health: Health | undefined, now: number): string[] {
  const { name, detail } = nameParts(server);
  return [
    health ? HEALTH_DOT[health] : paint('dim', '·'),
    paint('bold', name),
    paint('dim', detail ?? ''),
    portCell(server, health),
    String(server.pid),
    `${server.cpuPercent.toFixed(1)}%`,
    formatBytes(server.memoryBytes),
    server.startedAt ? formatDuration(now - server.startedAt.getTime()) : '?',
    reachOf(server.addresses) === Reach.Network ? paint('yellow', Reach.Network) : Reach.Local,
    server.cwd ? shortenHome(server.cwd) : paint('dim', '?'),
  ];
}

function printServers(servers: Server[]): void {
  const now = Date.now();
  console.log(table(WIDE_HEADER, [{ title: '', rows: servers.map((server) => wideRow(server, undefined, now)) }]));
}

export async function listCommand(platform: PlatformAdapter, options: ListOptions): Promise<ExitCode> {
  const servers = await scan(platform);
  const shown = options.all ? servers : servers.filter(isPrimary);
  // checkAll only probes servers marked safe: dev servers and web services, not databases.
  const health = await checkAll(shown);

  if (options.json) {
    console.log(JSON.stringify(shown.map((server) => ({ ...server, name: displayName(server), health: health.get(server) ?? null })), null, 2));
    return ExitCode.Ok;
  }

  const now = Date.now();
  const groups = groupServers(shown, options.all);
  const row = options.all ? wideRow : serverRow;
  if (groups.length === 0) console.log(paint('dim', 'Nothing you started is listening.'));
  else {
    const sections = groups.map(({ section, servers: rows }) => ({
      title: section.title,
      rows: rows.map((server) => row(server, health.get(server), now)),
    }));
    console.log(table(options.all ? WIDE_HEADER : null, sections));
  }

  const hidden = servers.length - shown.length;
  if (hidden > 0) console.log(paint('dim', `\n${hidden} more (apps & system) · portlight ls --all`));
  return ExitCode.Ok;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

const OUTCOME_TEXT: Record<StopOutcome, string> = {
  [StopOutcome.Stopped]: paint('green', 'stopped'),
  [StopOutcome.Forced]: paint('yellow', 'force-stopped (ignored SIGTERM)'),
  [StopOutcome.AlreadyGone]: 'already gone',
  [StopOutcome.Cancelled]: 'not stopped (password dialog cancelled)',
  [StopOutcome.Refused]: paint('red', 'refused'),
  [StopOutcome.Failed]: paint('red', 'failed'),
};

function printResult(result: StopResult, target?: Server): void {
  const reason = result.reason ? `: ${result.reason}` : '';
  const what = target?.container ? `Container ${safeText(target.container.name)}` : `PID ${result.pid}`;
  console.log(`${what} on :${result.port} ${OUTCOME_TEXT[result.outcome]}${reason}`);
}

const FAILED_OUTCOMES: readonly StopOutcome[] = [StopOutcome.Refused, StopOutcome.Failed];

/** After stopping, the port must actually be released: shared sockets can outlive the process we stopped. */
async function reportIfStillHeld(platform: PlatformAdapter, port: number): Promise<boolean> {
  const holders = await portHolders(platform, port);
  if (!holders) return false;
  const by = holders.hidden ? 'a process Portlight cannot see' : `PID ${holders.pids.join(', ')}`;
  console.log(paint('red', `\nPort ${port} is still held by ${by}.`));
  return true;
}

/** `port` is set when the user asked for a port to be freed; it is then re-checked after stopping. */
async function stopTargets(
  platform: PlatformAdapter,
  targets: Server[],
  question: string,
  options: StopCommandOptions,
  port?: number,
): Promise<ExitCode> {
  printServers(targets);
  // Drop what would be refused anyway, so we never ask "stop it?" about something we won't stop.
  const me = currentUser();
  const checked = targets.map((target) => ({ target, reason: stopRefusal(target, me) }));
  const refused = checked.filter(({ reason }) => reason !== null);
  refused.forEach(({ target, reason }) => printResult({ pid: target.pid, port: target.port, outcome: StopOutcome.Refused, reason: reason ?? undefined }));
  // One stop per process or container: a pid listening on several ports only needs one signal.
  const stoppable = new Map(checked.filter(({ reason }) => reason === null).map(({ target }) => [stopKey(target), target]));
  if (stoppable.size === 0) return ExitCode.Error;

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.error('Not a terminal, so I cannot ask. Re-run with -y to stop without asking.');
      return ExitCode.Usage;
    }
    if (!(await confirm(`\n${question}`))) return ExitCode.Ok;
  }
  if ([...stoppable.values()].some((target) => needsPassword(target, me))) {
    console.log(paint('dim', 'macOS will ask for your password: it runs as another user / for the whole Mac.'));
  }
  const toStop = [...stoppable.values()];
  const results = await Promise.all(toStop.map((target) => stopTarget(platform, target)));
  results.forEach((result, i) => printResult(result, toStop[i]));
  const failed = refused.length > 0 || results.some((result) => FAILED_OUTCOMES.includes(result.outcome));
  const stillHeld = port !== undefined && (await reportIfStillHeld(platform, port));
  return failed || stillHeld ? ExitCode.Error : ExitCode.Ok;
}

const HIDDEN_HOLDER_TEXT = 'is held by a process Portlight cannot see (owned by another user or root).';

export async function killCommand(platform: PlatformAdapter, target: number, byPid: boolean, options: StopCommandOptions): Promise<ExitCode> {
  const servers = await scan(platform);
  // --pid means that process itself: a container's port is held by the runtime's pid, and asking to
  // stop that pid must be judged as the runtime (refused), not as a `docker stop` of each container.
  const matches = servers
    .filter((server) => (byPid ? server.pid : server.port) === target)
    .map((server) => (byPid ? { ...server, container: null } : server));
  if (matches.length > 0) {
    const what = byPid ? `PID ${target}` : `everything on port ${target}`;
    return stopTargets(platform, matches, `Stop ${what}?`, options, byPid ? undefined : target);
  }
  if (byPid) console.log(`PID ${target} is not listening on any port.`);
  else if (!(await isPortBindable(target))) console.log(`Port ${target} ${HIDDEN_HOLDER_TEXT}`);
  else console.log(`Nothing is listening on port ${target}.`);
  return ExitCode.Error;
}

export async function freeCommand(platform: PlatformAdapter, port: number, options: StopCommandOptions): Promise<ExitCode> {
  const holders = (await scan(platform)).filter((server) => server.port === port);
  if (holders.length > 0) {
    console.log(`Port ${port} is taken by:\n`);
    return stopTargets(platform, holders, `Stop it to free port ${port}?`, options, port);
  }
  if (!(await isPortBindable(port))) {
    console.log(paint('red', `Port ${port} ${HIDDEN_HOLDER_TEXT}`));
    return ExitCode.Error;
  }
  console.log(paint('green', `Port ${port} is free.`));
  return ExitCode.Ok;
}

export async function openCommand(platform: PlatformAdapter, port: number): Promise<ExitCode> {
  const url = `http://${LOCALHOST}:${port}`;
  await platform.openUrl(url);
  console.log(`Opened ${url}`);
  return ExitCode.Ok;
}

export interface TrayCommandOptions {
  foreground: boolean;
  stop: boolean;
}

export async function trayCommand(platform: PlatformAdapter, options: TrayCommandOptions): Promise<ExitCode> {
  const running = await runningTrayPid(platform);
  if (options.stop) {
    if (running === null) {
      console.log('Portlight is not in the menu bar.');
      return ExitCode.Ok;
    }
    process.kill(running, Signal.Term);
    console.log('Removed Portlight from the menu bar.');
    return ExitCode.Ok;
  }
  if (running !== null && !(options.foreground && running === process.pid)) {
    console.log(`Portlight is already in the menu bar (PID ${running}).`);
    return ExitCode.Ok;
  }
  if (!options.foreground) {
    const pid = await startTrayInBackground(platform);
    console.log(`Portlight is in your menu bar (PID ${pid}). \`portlight tray --stop\` removes it.`);
    return ExitCode.Ok;
  }

  await recordSelf(platform);
  const quit = () => process.exit(ExitCode.Ok);
  process.once('SIGTERM', quit);
  process.once('SIGINT', quit);
  process.once('exit', clearTrayPid);
  await runTray(platform);
  return ExitCode.Ok;
}

export function loginCommand(platform: PlatformAdapter, setting: LoginSetting | undefined): ExitCode {
  try {
    if (setting !== undefined) setTrayAtLogin(platform, setting === LoginSetting.On);
  } catch (error) {
    console.error((error as Error).message);
    return ExitCode.Error;
  }
  console.log(platform.isStartAtLogin() ? 'Portlight starts in the menu bar when you log in.' : 'Portlight does not start at login.');
  return ExitCode.Ok;
}
