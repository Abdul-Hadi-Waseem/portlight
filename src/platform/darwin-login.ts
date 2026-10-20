import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LAUNCH_AGENT_LABEL } from './constants.js';

export interface LoginItem {
  /** Absolute program + arguments: launchd starts it without the user's shell or nvm. */
  programArguments: string[];
  /** PATH to start with, so tools like `docker` resolve as they do in the user's terminal. */
  path: string;
  logFile: string;
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = (text: string) => text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
const string = (text: string) => `<string>${xml(text)}</string>`;

/** A LaunchAgent that starts the tray once at login (no KeepAlive: Quit means quit). */
export function launchAgentPlist(item: LoginItem): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${string(LAUNCH_AGENT_LABEL)}
  <key>ProgramArguments</key>
  <array>${item.programArguments.map(string).join('')}</array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key>${string(item.path)}</dict>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key>${string('Interactive')}
  <key>StandardOutPath</key>${string(item.logFile)}
  <key>StandardErrorPath</key>${string(item.logFile)}
</dict>
</plist>
`;
}

export function launchAgentFile(dir: string = path.join(os.homedir(), 'Library', 'LaunchAgents')): string {
  return path.join(dir, `${LAUNCH_AGENT_LABEL}.plist`);
}

export function isLoginItemEnabled(file: string = launchAgentFile()): boolean {
  return existsSync(file);
}

/**
 * Writes or removes the LaunchAgent. macOS loads it at the next login. Nothing is loaded or
 * unloaded now: the tray is usually already running, and unloading a job launchd started would
 * kill the very tray the user clicked in.
 */
export function setLoginItem(item: LoginItem | null, file: string = launchAgentFile()): void {
  if (!item) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, launchAgentPlist(item));
}
