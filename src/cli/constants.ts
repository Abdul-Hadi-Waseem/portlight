export const Command = {
  List: 'ls',
  Kill: 'kill',
  Free: 'free',
  Open: 'open',
  Tray: 'tray',
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

export const HELP = `portlight — see what is listening on your ports, and stop it safely

Usage
  portlight [ls] [--all] [--json]   list listening servers (dev servers only unless --all)
  portlight kill <port> [-y]        stop everything listening on a port
  portlight kill --pid <pid> [-y]   stop one process
  portlight free <port> [-y]        is the port free? if not, offer to stop what holds it
  portlight open <port>             open http://localhost:<port>
  portlight tray                    put Portlight in the menu bar (runs in the background)
  portlight tray --stop             remove it from the menu bar
  portlight login on|off            start the menu bar icon when you log in

Stopping re-checks that the PID still belongs to the same process, never touches
other users', root or system processes, and sends SIGTERM before SIGKILL.`;

export const LoginSetting = {
  On: 'on',
  Off: 'off',
} as const;
export type LoginSetting = (typeof LoginSetting)[keyof typeof LoginSetting];
