import type { Listener } from '../core/types.js';
import { LSTART_MONTHS, NETSTAT_LISTEN_PATTERN, PS_COMMAND_PATTERN, PS_LEADING_TOKENS } from './constants.js';

export interface PsRow {
  pid: number;
  ppid: number;
  user: string;
  state: string;
  cpuPercent: number;
  memoryBytes: number;
  startedAt: Date | null;
  commandLine: string;
}

function toPort(value: string): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/** Splits an lsof address like `*:3000`, `127.0.0.1:3000` or `[::1]:3000`. */
export function splitAddress(name: string): { address: string; port: number } | null {
  const colon = name.lastIndexOf(':');
  const port = colon === -1 ? null : toPort(name.slice(colon + 1));
  return port === null ? null : { address: name.slice(0, colon).replace(/^\[|\]$/g, ''), port };
}

/** Splits a netstat address like `*.5432`, `127.0.0.1.3000` or `::1.3000` (port after the last dot). */
export function splitNetstatAddress(name: string): { address: string; port: number } | null {
  const dot = name.lastIndexOf('.');
  const port = dot === -1 ? null : toPort(name.slice(dot + 1));
  return port === null ? null : { address: name.slice(0, dot), port };
}

function dedupe(listeners: Listener[]): Listener[] {
  const seen = new Set<string>();
  return listeners.filter((listener) => {
    const key = `${listener.pid}|${listener.address}|${listener.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Union of both sources, one entry per pid + address + port (the first source's name wins). */
export function mergeListeners(...sources: Listener[][]): Listener[] {
  return dedupe(sources.flat());
}

/** Parses `netstat -anv -p tcp`. Sees every user's sockets, but truncates process names to 16 chars. */
export function parseNetstatListeners(output: string): Listener[] {
  const listeners: Listener[] = [];
  for (const line of output.split('\n')) {
    const match = NETSTAT_LISTEN_PATTERN.exec(line);
    if (!match) continue;
    const [, localAddress = '', processName = '', pid = ''] = match;
    const parsed = splitNetstatAddress(localAddress);
    if (parsed) listeners.push({ pid: Number(pid), ...parsed, processName: processName.trim() });
  }
  return dedupe(listeners);
}

/** Parses `lsof -nP -iTCP -sTCP:LISTEN -F pcn`. Only sees this user's sockets unless run as root. */
export function parseLsofListeners(output: string): Listener[] {
  const listeners: Listener[] = [];
  let pid = 0;
  let processName = '';
  for (const line of output.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      pid = Number(value);
      processName = '';
    } else if (field === 'c') {
      processName = value;
    } else if (field === 'n' && pid > 0) {
      const parsed = splitAddress(value);
      if (parsed) listeners.push({ pid, ...parsed, processName });
    }
  }
  return dedupe(listeners);
}

/** Parses an `lstart` value such as `Tue Oct 20 18:15:54 2026` (already split into 5 tokens). */
export function parseLstart(tokens: string[]): Date | null {
  const [, monthName, day, time, year] = tokens;
  const month = LSTART_MONTHS.indexOf(monthName as (typeof LSTART_MONTHS)[number]);
  const [h, m, s] = (time ?? '').split(':').map(Number);
  const date = new Date(Number(year), month, Number(day), h, m, s);
  return month === -1 || Number.isNaN(date.getTime()) ? null : date;
}

/** Parses `ps -o <PS_FIELDS>`. */
export function parsePs(output: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of output.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length <= PS_LEADING_TOKENS) continue;
    const [pid, ppid, user, state, cpu, rssKb] = tokens;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      user: user ?? '',
      state: state ?? '',
      cpuPercent: Number(cpu),
      memoryBytes: Number(rssKb) * 1024,
      startedAt: parseLstart(tokens.slice(6, 11)),
      commandLine: PS_COMMAND_PATTERN.exec(line)?.[1] ?? '',
    });
  }
  return rows;
}

/** Parses `ps -o pid=,comm=` into pid → executable name (basename of the path). */
export function parsePsComm(output: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (match?.[1] && match[2]) names.set(Number(match[1]), match[2].slice(match[2].lastIndexOf('/') + 1));
  }
  return names;
}

/** Parses `lsof -a -nP -p <pids> -d cwd -Fn`. */
export function parseLsofCwd(output: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of output.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid > 0) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** The inverse of parseLstart, single-spaced: what `ps -o lstart= | tr -s ' '` prints for this time. */
export function formatLstart(date: Date): string {
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  return `${WEEKDAYS[date.getDay()]} ${LSTART_MONTHS[date.getMonth()]} ${date.getDate()} ${time} ${date.getFullYear()}`;
}
