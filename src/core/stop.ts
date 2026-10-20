import { setTimeout as sleep } from 'node:timers/promises';
import { ALIVE_POLL_MS, Signal, STOP_FORCE_WAIT_MS, STOP_GRACE_MS } from './constants.js';
import { classify, currentUser } from './scan.js';
import { ServerKind, StopOutcome, type PlatformAdapter, type ProcessInfo, type Server, type StopResult } from './types.js';

export interface StopOptions {
  graceMs?: number;
  forceWaitMs?: number;
}

type Identity = Pick<ProcessInfo, 'user' | 'name' | 'startedAt' | 'commandLine'>;

export interface RefusalOptions {
  /** Another user's process may be stopped (with an admin password): recognised services only. */
  allowOtherUser?: boolean;
}

/**
 * Why `live` must not be stopped, or null when it is the same process the user picked and not
 * part of macOS or the container runtime. Used before prompting and again right before acting.
 */
export function refusalReason(target: Server, live: Identity | undefined, me: string, options: RefusalOptions = {}): string | null {
  if (!live || !live.user) return `could not read details for PID ${target.pid} (it may have just exited)`;
  if (live.user !== me && !options.allowOtherUser) return `owned by ${live.user || 'another user'}, not ${me}`;
  // Judge the program itself (path, runtime), relative to whoever owns it.
  const kind = classify(live, live.user);
  if (kind === ServerKind.System) return 'system process, left alone';
  if (kind === ServerKind.ContainerRuntime) {
    return 'this is the container runtime itself; stopping it would stop every container. Use `docker stop <container>`';
  }
  if (!target.startedAt || !live.startedAt) return `could not read the start time of PID ${target.pid}`;
  if (live.startedAt.getTime() !== target.startedAt.getTime() || live.commandLine !== target.commandLine) {
    return `PID ${target.pid} now belongs to a different process`;
  }
  return null;
}

export async function waitForExit(platform: PlatformAdapter, pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await platform.isRunning(pid))) return true;
    await sleep(ALIVE_POLL_MS);
  }
  return !(await platform.isRunning(pid));
}

function signal(pid: number, name: (typeof Signal)[keyof typeof Signal]): void {
  try {
    process.kill(pid, name);
  } catch (error) {
    // Already gone between our check and the signal: that is the outcome we wanted.
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

/**
 * Stops a server the user picked from an earlier scan:
 * 1. re-read the process and refuse unless it is still the same one (start time + command),
 *    owned by this user and not a system process;
 * 2. SIGTERM, plus SIGCONT so a suspended (Ctrl-Z) process can act on it (skipped where the OS
 *    has no polite stop: Windows);
 * 3. after the grace period, verify identity again and only then SIGKILL.
 */
export async function stopServer(
  platform: PlatformAdapter,
  target: Server,
  options: StopOptions & RefusalOptions = {},
): Promise<StopResult> {
  const { pid, port } = target;
  const me = currentUser();
  const result = (outcome: StopOutcome, reason?: string): StopResult => ({ pid, port, outcome, reason });
  const verify = async () => refusalReason(target, (await platform.getProcesses([pid])).get(pid), me, options);

  try {
    if (!(await platform.isRunning(pid))) return result(StopOutcome.AlreadyGone);
    const refusal = await verify();
    if (refusal) return result(StopOutcome.Refused, refusal);

    if (platform.gracefulStop) {
      signal(pid, Signal.Term);
      signal(pid, Signal.Continue);
      if (await waitForExit(platform, pid, options.graceMs ?? STOP_GRACE_MS)) return result(StopOutcome.Stopped);
    }

    const refusalBeforeKill = await verify();
    if (refusalBeforeKill) return result(StopOutcome.Refused, `${refusalBeforeKill} (checked before SIGKILL)`);
    signal(pid, Signal.Kill);
    if (await waitForExit(platform, pid, options.forceWaitMs ?? STOP_FORCE_WAIT_MS)) return result(StopOutcome.Forced);
    return result(StopOutcome.Failed, 'still running after SIGKILL');
  } catch (error) {
    return result(StopOutcome.Failed, (error as Error).message);
  }
}
