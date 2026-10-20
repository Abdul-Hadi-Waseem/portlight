import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configFile } from './paths.js';
import { safeText } from './format.js';

export interface NameRule {
  /** Plain text the command line must contain (case-insensitive). */
  match: string;
  name: string;
}

/** ~/.config/portlight/config.json. Every field is optional; a missing or broken file means defaults. */
export interface PortlightConfig {
  /** Names by port: `{ "9000": "Payments API" }`. */
  names: Record<string, string>;
  /** Names by command line: `[{ "match": "gateway", "name": "Gateway" }]`. */
  rules: NameRule[];
  /** Notify when a dev server, container or service starts or stops (menu bar). */
  notifications: boolean;
  /** App to open project folders in, e.g. "Cursor". Default: the first known editor installed. */
  editor: string | null;
}

export const DEFAULT_CONFIG: PortlightConfig = { names: {}, rules: [], notifications: true, editor: null };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keeps only well-formed entries: a typo in the file must never break the menu. */
export function parseConfig(raw: unknown): PortlightConfig {
  if (!isRecord(raw)) return { ...DEFAULT_CONFIG };
  const names: Record<string, string> = {};
  if (isRecord(raw.names)) {
    for (const [port, name] of Object.entries(raw.names)) if (typeof name === 'string' && name.trim()) names[port] = safeText(name.trim());
  }
  const rules = Array.isArray(raw.rules)
    ? raw.rules.flatMap((rule): NameRule[] =>
        isRecord(rule) && typeof rule.match === 'string' && rule.match && typeof rule.name === 'string' && rule.name.trim()
          ? [{ match: rule.match, name: safeText(rule.name.trim()) }]
          : [],
      )
    : [];
  return {
    names,
    rules,
    notifications: typeof raw.notifications === 'boolean' ? raw.notifications : DEFAULT_CONFIG.notifications,
    editor: typeof raw.editor === 'string' && raw.editor.trim() ? raw.editor.trim() : null,
  };
}

let cache: { file: string; mtimeMs: number; config: PortlightConfig } | null = null;

/** Reads the config, re-reading only when the file changed (the tray asks every few seconds). */
export function loadConfig(file: string = configFile()): PortlightConfig {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.config;
  let config: PortlightConfig;
  try {
    config = parseConfig(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
  cache = { file, mtimeMs, config };
  return config;
}

/** Changes some settings, keeping everything else in the file as the user wrote it. */
export function updateConfig(changes: Partial<PortlightConfig>, file: string = configFile()): void {
  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (isRecord(parsed)) existing = parsed;
  } catch {
    // no file yet, or unreadable: start fresh
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...existing, ...changes }, null, 2)}\n`);
}

/** The user's own name for a server, if their config gives one: by port first, then by command. */
export function customName(config: PortlightConfig, port: number, commandLine: string): string | null {
  const byPort = config.names[String(port)];
  if (byPort) return byPort;
  const command = commandLine.toLowerCase();
  return config.rules.find((rule) => command.includes(rule.match.toLowerCase()))?.name ?? null;
}
