import os from 'node:os';
import path from 'node:path';
import { Health } from '../core/types.js';

/** Menu item ids are `<action>:<pid>:<port>`, so a click maps back to the exact server snapshot. */
export const MenuAction = {
  Open: 'open',
  CopyUrl: 'copy-url',
  CopyPid: 'copy-pid',
  CopyContainer: 'copy-container',
  Stop: 'stop',
  Quit: 'quit',
  ToggleLogin: 'toggle-login',
  Info: 'info',
  Header: 'header',
  Server: 'server',
  Group: 'group',
  Separator: 'sep',
} as const;
export type MenuAction = (typeof MenuAction)[keyof typeof MenuAction];

/** Native menus can't color text; colored emoji survive on macOS and Windows. */
export const HEALTH_EMOJI: Record<Health, string> = {
  [Health.Up]: '🟢',
  [Health.NotHttp]: '⚪',
  [Health.Down]: '🔴',
};

/** Background refresh is a port scan only: it never touches the servers, and never replaces an open menu. */
export const TRAY_REFRESH_MS = 3000;
/** Native menu items don't wrap; explanations are split into lines this long. */
export const MENU_TEXT_WIDTH = 46;
/** Health is checked when the menu opens and reused for this long, so servers that log every request aren't spammed. */
export const HEALTH_CACHE_MS = 30_000;
export const TRAY_TOOLTIP = 'Portlight';
export const NOTIFY_TITLE = 'Portlight';

export const STATE_DIR = path.join(os.homedir(), '.config', 'portlight');
export const TRAY_PID_FILE = path.join(STATE_DIR, 'tray.json');
/** The arguments a background tray runs with; also how a pid is recognised as our tray. */
export const TRAY_COMMAND_MARKER = 'tray --foreground';
export const CLI_ENTRY_NAME = 'main.js';
export const TRAY_LOG_FILE = path.join(STATE_DIR, 'tray.log');

export const ASSETS_DIR = new URL('../../../assets/', import.meta.url);
export const TRAY_ICON_PNG = new URL('tray-icon.png', ASSETS_DIR);
export const TRAY_ICON_ICO = new URL('tray-icon.ico', ASSETS_DIR);

/** Install locations that can vanish or change under us: never used for the login item. */
export const EPHEMERAL_PATH_MARKERS = ['/_npx/', '/.npm/_cacache/', '/pnpm/dlx/'] as const;

/** Menu actions that act on one server. Clicks on anything else (info lines, headers) do nothing. */
export const SERVER_ACTIONS: readonly string[] = [
  MenuAction.Open,
  MenuAction.CopyUrl,
  MenuAction.CopyPid,
  MenuAction.CopyContainer,
  MenuAction.Stop,
];
