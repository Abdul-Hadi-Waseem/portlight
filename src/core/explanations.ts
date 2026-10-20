/**
 * Plain-language answers to "what is this and do I need to care?" for ports the user didn't open.
 * Keyed by app name (from the .app bundle) or executable name.
 */
export const EXPLANATIONS: Readonly<Record<string, string>> = {
  'Visual Studio Code': "VS Code's extensions (ESLint, Prettier, Copilot, debuggers) use these to talk to the editor. They close when you quit VS Code.",
  Cursor: "Cursor's extensions use these to talk to the editor. They close when you quit Cursor.",
  Docker: 'Docker Desktop forwards ports from your containers. Stop the container, not Docker.',
  OrbStack: 'OrbStack forwards ports from your containers. Stop the container, not OrbStack.',
  rapportd: 'Part of macOS: AirDrop, Handoff and the shared clipboard with your iPhone.',
  launchd: 'Part of macOS: it holds the port for a background service until that service is needed.',
  ControlCenter: 'Part of macOS: AirPlay Receiver. Turn it off in System Settings → General → AirDrop & Handoff.',
  sharingd: 'Part of macOS: file and screen sharing.',
  Spotify: 'Spotify Connect: lets your phone or other devices control playback on this Mac.',
  'Google Chrome': 'Chrome, usually for a debugging connection or an extension.',
  Figma: 'Figma, talking to its desktop helper for fonts and plugins.',
  PostgreSQL: 'A PostgreSQL database server.',
  MySQL: 'A MySQL database server.',
  MongoDB: 'A MongoDB database server.',
  Redis: 'A Redis server (cache / key-value store).',
};

export const APP_EXPLANATION = (app: string) => `Opened by ${app}, to talk to its own helper programs. Nothing to do.`;
export const SYSTEM_EXPLANATION = 'Part of macOS or run by another user. Portlight leaves it alone.';

/** Human names for macOS daemons whose executable names mean nothing to most people. */
export const FRIENDLY_NAMES: Readonly<Record<string, string>> = {
  rapportd: 'macOS · AirDrop & Handoff',
  launchd: 'macOS · launchd',
  ControlCenter: 'macOS · AirPlay Receiver',
  sharingd: 'macOS · Sharing',
};

/** What to do instead, when Portlight won't stop something itself. */
export const HOW_TO_STOP = {
  system: 'It is part of macOS. Leave it running.',
  otherUser: (user: string) => `It runs as "${user}", not as you. Stop it from the app or service that started it (for Homebrew: brew services stop <name>).`,
  containerRuntime: 'Stopping it would stop every container. Stop the container instead (docker stop <name>).',
  app: (app: string) => `It belongs to ${app}. Quit ${app} to close it.`,
} as const;
