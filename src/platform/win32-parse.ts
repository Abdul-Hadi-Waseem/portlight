import type { Listener, ProcessInfo } from '../core/types.js';
import { WINDOWS_ISO_TIME_SAFE } from './constants.js';

/** One row of the combined scan script's `listeners` array (Get-NetTCPConnection). */
export interface WinListenerRow {
  address?: unknown;
  port?: unknown;
  pid?: unknown;
}

/** One row of the `processes` array (Win32_Process + GetOwner). */
export interface WinProcessRow {
  pid?: unknown;
  ppid?: unknown;
  name?: unknown;
  cmd?: unknown;
  created?: unknown;
  mem?: unknown;
  user?: unknown;
}

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** `node.exe` → `node`, so the same rules (DEV_RUNTIME_NAMES, frameworks) work on both systems. */
export function stripExe(name: string): string {
  return name.replace(/\.exe$/i, '');
}

/** Windows says 0.0.0.0 / :: for "all interfaces"; the rest of Portlight (like netstat) says `*`. */
export function normalizeWinAddress(address: string): string {
  return address === '0.0.0.0' || address === '::' ? '*' : address;
}

/** PowerShell's ConvertTo-Json gives an object for one item and an array for several: always an array. */
export function asRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value && typeof value === 'object' ? [value as T] : [];
}

export function parseWinListeners(rows: WinListenerRow[], names: Map<number, string>): Listener[] {
  const seen = new Set<string>();
  const listeners: Listener[] = [];
  for (const row of rows) {
    const pid = asNumber(row.pid);
    const port = asNumber(row.port);
    const address = asString(row.address);
    // pid 0/4 are the kernel ("System Idle", "System"): not something anyone started.
    if (pid === null || pid <= 4 || port === null || port <= 0 || port > 65535 || address === null) continue;
    const normalized = normalizeWinAddress(address);
    const key = `${pid}|${normalized}|${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listeners.push({ pid, port, address: normalized, processName: names.get(pid) ?? String(pid) });
  }
  return listeners;
}

/**
 * Processes from the scan script. Another user's process (a service) may come back without its
 * command line or owner unless Portlight runs elevated: those fields are just empty then.
 */
export function parseWinProcesses(rows: WinProcessRow[]): Map<number, ProcessInfo> {
  const processes = new Map<number, ProcessInfo>();
  for (const row of rows) {
    const pid = asNumber(row.pid);
    if (pid === null) continue;
    const created = asString(row.created);
    const startedAt = created && WINDOWS_ISO_TIME_SAFE.test(created) ? new Date(created) : null;
    processes.set(pid, {
      pid,
      ppid: asNumber(row.ppid) ?? 0,
      user: asString(row.user) ?? '',
      name: stripExe(asString(row.name) ?? ''),
      state: '',
      cpuPercent: 0,
      memoryBytes: asNumber(row.mem) ?? 0,
      startedAt: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null,
      commandLine: asString(row.cmd) ?? '',
      // Windows doesn't expose another process's working folder; the project comes from the command.
      cwd: null,
    });
  }
  return processes;
}
