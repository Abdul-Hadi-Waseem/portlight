export const Command = {
  List: 'ls',
  Kill: 'kill',
  Free: 'free',
  Open: 'open',
  Tray: 'tray',
  Autostart: 'autostart',
  /** 0.1.0's name for autostart; still accepted, no longer advertised (it read like an account login). */
  Login: 'login',
  Help: 'help',
} as const;
export type Command = (typeof Command)[keyof typeof Command];

export const TargetKind = {
  Port: 'port',
  Pid: 'pid',
} as const;
export type TargetKind = (typeof TargetKind)[keyof typeof TargetKind];

export const MAX_PORT = 65535;
export const DIGITS_ONLY = /^\d+$/;

export const ANSI = {
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
} as const;
/** Color codes and OSC 8 hyperlinks: invisible when measuring column widths. */
export const ANSI_PATTERN = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g;
export const STATUS_DOT = '●';

export const HELP = `Portlight: see what's listening on your ports, and stop it safely.

Start here
  portlight                 list your dev servers, containers and databases
  portlight tray            put Portlight in your menu bar (icon at the top right of your screen)
  portlight autostart on    start the menu bar icon automatically when your Mac starts

Free up a port
  portlight free 3000       is port 3000 free? if not, offer to stop whatever holds it
  portlight kill 3000       stop everything listening on port 3000 (add -y to skip the question)
  portlight kill --pid 4121 stop one process by its PID

More
  portlight ls --all        every listening port, including apps and macOS, with PID and CPU
  portlight ls --json       the same as JSON, for scripts
  portlight open 3000       open http://localhost:3000 in your browser
  portlight tray --stop     remove the menu bar icon
  portlight autostart off   stop starting it automatically

Portlight never stops macOS's own processes, double-checks the process right before
stopping it, and asks politely (SIGTERM) before forcing anything.`;

export const LoginSetting = {
  On: 'on',
  Off: 'off',
} as const;
export type LoginSetting = (typeof LoginSetting)[keyof typeof LoginSetting];

export const WELCOME = `Welcome to Portlight!

It shows what is running on your ports (dev servers, Docker containers, databases)
and lets you stop any of them safely.

  portlight tray        put it in your menu bar: click the icon at the top right
  portlight free 3000   free up a port that's "already in use"
  portlight help        everything else

Watch your ports without the hassle. ⚡
`;

export const EMPTY_HINT = `Nothing you started is listening right now.
Start a dev server (npm run dev, rails s, docker compose up…) and it shows up here.`;

export const TRAY_TIP = 'Tip: portlight tray puts this list in your menu bar.';
