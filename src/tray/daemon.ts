import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { PlatformAdapter } from '../core/types.js';
import { CLI_ENTRY_NAME, EPHEMERAL_PATH_MARKERS, STATE_DIR, TRAY_COMMAND_MARKER, TRAY_LOG_FILE, TRAY_PID_FILE } from './constants.js';

interface TrayRecord {
  pid: number;
  /** ms since epoch, from ps: identifies this exact process, since pids get reused. */
  startedAt: number;
}

function readRecord(): TrayRecord | null {
  try {
    const record = JSON.parse(readFileSync(TRAY_PID_FILE, 'utf8')) as TrayRecord;
    return Number.isInteger(record.pid) && record.pid > 0 && Number.isFinite(record.startedAt) ? record : null;
  } catch {
    return null;
  }
}

/**
 * PID of the running tray, or null. The pid file can outlive the tray (crash, SIGKILL, reboot) and
 * its pid be reused, so the process must still be our tray: the same start time, and a command line
 * that ends in `main.js tray --foreground`. A stale file is removed.
 */
export async function runningTrayPid(platform: PlatformAdapter): Promise<number | null> {
  const record = readRecord();
  if (!record) return null;
  const live = (await platform.getProcesses([record.pid])).get(record.pid);
  const isOurs =
    live !== undefined &&
    live.commandLine.endsWith(`${CLI_ENTRY_NAME} ${TRAY_COMMAND_MARKER}`) &&
    live.startedAt?.getTime() === record.startedAt;
  if (!isOurs) clearTrayPid();
  return isOurs ? record.pid : null;
}

export function writeTrayRecord(record: TrayRecord): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(TRAY_PID_FILE, JSON.stringify(record));
}

/** Records `pid` with its start time as reported by ps. False if ps can't see it. */
async function recordProcess(platform: PlatformAdapter, pid: number): Promise<boolean> {
  const startedAt = (await platform.getProcesses([pid])).get(pid)?.startedAt?.getTime();
  if (startedAt === undefined) return false;
  writeTrayRecord({ pid, startedAt });
  return true;
}

/** Called by the tray process itself, in case it was started with --foreground by hand. */
export async function recordSelf(platform: PlatformAdapter): Promise<void> {
  await recordProcess(platform, process.pid);
}

export function clearTrayPid(): void {
  rmSync(TRAY_PID_FILE, { force: true });
}

/** The exact command a background tray runs: absolute node + CLI, so it works without a shell. */
export function trayCommandLine(cliEntry: string = fileURLToPath(new URL(`../cli/${CLI_ENTRY_NAME}`, import.meta.url))): string[] {
  return [process.execPath, cliEntry, ...TRAY_COMMAND_MARKER.split(' ')];
}

/**
 * True when this copy of the CLI is temporary (an `npx` cache or a temp folder): that path can be
 * cleared or refilled with other code, so it must never be what runs at login.
 */
export function isEphemeralInstall(cliEntry: string = trayCommandLine()[1] ?? ''): boolean {
  // macOS spells the temp folder two ways (/var/… and /private/var/…): check both.
  const tempDirs = [os.tmpdir(), realpathSync(os.tmpdir())];
  return EPHEMERAL_PATH_MARKERS.some((marker) => cliEntry.includes(marker)) || tempDirs.some((dir) => cliEntry.startsWith(dir));
}

export function setTrayAtLogin(platform: PlatformAdapter, enabled: boolean): void {
  if (enabled && isEphemeralInstall()) {
    throw new Error('Install Portlight first (npm i -g portlight): a temporary npx copy cannot start at login.');
  }
  platform.setStartAtLogin(enabled ? { command: trayCommandLine(), logFile: TRAY_LOG_FILE } : null);
}

/**
 * Starts `portlight tray --foreground` detached from this terminal, logging to the state dir.
 * spawn() returns once the child has exec'd, so ps already shows its real command and start time,
 * and the record is complete before a second `portlight tray` could look for it.
 */
export async function startTrayInBackground(platform: PlatformAdapter): Promise<number> {
  mkdirSync(STATE_DIR, { recursive: true });
  const log = openSync(TRAY_LOG_FILE, 'a');
  const [node = process.execPath, ...args] = trayCommandLine();
  const child = spawn(node, args, { detached: true, stdio: ['ignore', log, log] });
  child.unref();
  if (!child.pid || !(await recordProcess(platform, child.pid))) throw new Error(`The tray did not start. See ${TRAY_LOG_FILE}.`);
  return child.pid;
}
