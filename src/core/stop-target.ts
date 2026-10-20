import os from 'node:os';
import path from 'node:path';
import { stopContainer } from '../sources/docker.js';
import { DEV_RUNTIME_NAMES, STOP_GRACE_MS } from './constants.js';
import { currentUser } from './scan.js';
import { refusalReason, stopServer, waitForExit, type StopOptions } from './stop.js';
import { AdminOutcome, ServerKind, StopOutcome, type PlatformAdapter, type Server, type StopResult } from './types.js';

/**
 * Started from inside the user's home folder: a dev server run with `sudo`, not a vendor daemon.
 * Without root, macOS doesn't reveal another user's working folder (cwd is null), so this is
 * usually false for root processes: the safe direction, a refusal rather than a guess.
 */
function startedInHome(server: Pick<Server, 'cwd'>, home: string): boolean {
  if (server.cwd === null) return false;
  // path.relative, not "starts with home + /": Windows separates with "\\".
  const inside = path.relative(home, server.cwd);
  return inside !== '' && !inside.startsWith('..') && !path.isAbsolute(inside);
}

/**
 * Another user's process may be stopped (after the admin password dialog) only when it is:
 * - a recognised service (PostgreSQL, Redis, nginx…), which is then stopped through its service
 *   manager, or killed only if it was started from the user's own folders; or
 * - a dev runtime (node, python…) started from the user's own folders, i.e. `sudo npm start`.
 * A vendor's background agent (VPN, security, MDM), often built on node/python/java and started
 * from `/`, stays off-limits.
 */
export function canStopAsAdmin(server: Pick<Server, 'kind' | 'processName' | 'cwd'>, home: string = os.homedir()): boolean {
  if (server.kind === ServerKind.Service) return true;
  const runtimes: readonly string[] = DEV_RUNTIME_NAMES;
  return runtimes.includes(server.processName) && startedInHome(server, home);
}

/** Stopping it will show the macOS password dialog. */
export function needsPassword(server: Pick<Server, 'container' | 'user'>, me: string): boolean {
  return !server.container && server.user !== me;
}

/**
 * Why `server` can't be stopped, judged from a scan (before asking the user). Containers are
 * stopped through Docker, so the runtime process that holds their port is not what is judged.
 */
export function stopRefusal(server: Server, me: string): string | null {
  if (server.container) return null;
  return refusalReason(server, { ...server, name: server.processName }, me, { allowOtherUser: canStopAsAdmin(server) });
}

/** What one stop acts on: a container, or a process (which may listen on several ports). */
export function stopKey(server: Server): string {
  return server.container ? `container:${server.container.id}` : `pid:${server.pid}`;
}

/**
 * Stops a scanned server the right way:
 * - a container: `docker stop`;
 * - a process run by a service manager that would restart it, or that runs for the whole Mac:
 *   through the manager (`brew services stop`, launchctl), with the password dialog when needed;
 * - another user's process with no manager: SIGTERM after the password dialog;
 * - otherwise our own process: SIGTERM, then SIGKILL (stopServer).
 * The process is re-identified first in every case.
 */
export async function stopTarget(platform: PlatformAdapter, server: Server, options: StopOptions = {}): Promise<StopResult> {
  if (server.container) return stopContainer(server);
  const { pid, port } = server;
  const result = (outcome: StopOutcome, reason?: string): StopResult => ({ pid, port, outcome, reason });
  const allowOtherUser = canStopAsAdmin(server);
  try {
    if (!(await platform.isRunning(pid))) return result(StopOutcome.AlreadyGone);
    const me = currentUser();
    const live = (await platform.getProcesses([pid])).get(pid);
    const refusal = refusalReason(server, live, me, { allowOtherUser });
    if (refusal) return result(StopOutcome.Refused, refusal);

    const job = await platform.findServiceJob(pid);
    const viaManager = job !== null && (job.keepAlive || job.needsAdmin || job.homebrewFormula !== null);
    if (!viaManager && live?.user === me) return stopServer(platform, server, { ...options, allowOtherUser });
    // Another user's process with no service manager: only one started from the user's own folders.
    if (!viaManager && !startedInHome(server, os.homedir())) {
      return result(StopOutcome.Refused, 'not run by a service, and not started from your folders');
    }
    if (!viaManager && !live?.startedAt) return result(StopOutcome.Refused, `could not read the start time of PID ${pid}`);

    const outcome = viaManager && job ? await platform.stopServiceJob(job) : await platform.adminTerminate(pid, live!.startedAt!);
    if (outcome.outcome === AdminOutcome.Cancelled) return result(StopOutcome.Cancelled);
    if (outcome.outcome === AdminOutcome.Failed) return result(StopOutcome.Failed, outcome.message);
    return (await waitForExit(platform, pid, options.graceMs ?? STOP_GRACE_MS))
      ? result(StopOutcome.Stopped)
      : result(StopOutcome.Failed, 'asked it to stop, but it is still running');
  } catch (error) {
    return result(StopOutcome.Failed, (error as Error).message);
  }
}

/**
 * What Stop will do, in words, for the confirmation dialog: the service it stops and for how long,
 * or the process it signals. Looked up fresh, so it describes what will really happen.
 */
export async function describeStop(platform: PlatformAdapter, server: Server): Promise<string> {
  if (server.container) return `Runs: docker stop ${server.container.name}`;
  const job = await platform.findServiceJob(server.pid);
  if (job?.homebrewFormula) return `Runs: brew services stop ${job.homebrewFormula}`;
  if (job && (job.keepAlive || job.needsAdmin)) {
    const until = job.needsAdmin ? 'until your Mac restarts' : 'until you next log in';
    return `Stops the ${job.needsAdmin ? 'system ' : ''}service "${job.label}" ${until}.`;
  }
  return [`PID ${server.pid}`, server.cwd].filter(Boolean).join(' · ');
}

/** Your own dev servers that can be stopped without a password: the "end of the day" set. */
export function stoppableDevServers(servers: Server[], me: string): Server[] {
  return servers.filter((server) => server.kind === ServerKind.Dev && !needsPassword(server, me) && stopRefusal(server, me) === null);
}
