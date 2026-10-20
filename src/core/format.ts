import os from 'node:os';
import { BYTE_UNITS, UNSAFE_TEXT_PATTERN } from './constants.js';

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** `~/repos/app` instead of `/Users/me/repos/app`. Output is safe to print. */
export function shortenHome(path: string, home: string = os.homedir()): string {
  return safeText(path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);
}

/**
 * Removes control and format characters (escape sequences, bidi overrides) from text that comes
 * from outside: package.json names, folder names, process names. A repo could otherwise put
 * terminal escape codes in its name and have them run in the user's terminal.
 */
export function safeText(text: string): string {
  return text.replace(UNSAFE_TEXT_PATTERN, '');
}

/** Splits text into lines of at most `width` characters, on spaces. For native menus, which don't wrap. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
