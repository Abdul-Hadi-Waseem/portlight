export const ServerKind = {
  Dev: 'dev',
  Service: 'service',
  App: 'app',
  Container: 'container',
  ContainerRuntime: 'container-runtime',
  System: 'system',
} as const;
export type ServerKind = (typeof ServerKind)[keyof typeof ServerKind];

export const StopOutcome = {
  Stopped: 'stopped',
  Forced: 'forced',
  AlreadyGone: 'already-gone',
  /** The user cancelled the password dialog. */
  Cancelled: 'cancelled',
  Refused: 'refused',
  Failed: 'failed',
} as const;
export type StopOutcome = (typeof StopOutcome)[keyof typeof StopOutcome];

/** One process listening on one TCP port, as reported by the OS. */
export interface Listener {
  pid: number;
  port: number;
  address: string;
  processName: string;
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  /** Full executable name; the listener source may truncate it. */
  name: string | null;
  /** Raw ps `stat`, e.g. `S`, `T` (stopped), `Z` (zombie). */
  state: string;
  cpuPercent: number;
  memoryBytes: number;
  startedAt: Date | null;
  commandLine: string;
  cwd: string | null;
}

/** A listening process enriched with what we know about it. One per pid + port. */
export interface Server {
  port: number;
  addresses: string[];
  pid: number;
  processName: string;
  user: string;
  kind: ServerKind;
  cpuPercent: number;
  memoryBytes: number;
  startedAt: Date | null;
  commandLine: string;
  cwd: string | null;
  /** Framework or service label, e.g. `Next.js`, `PostgreSQL`. */
  framework: string | null;
  /** Project name from package.json, the git root, or the folder. */
  project: string | null;
  /** The app it belongs to, from its .app bundle (`Visual Studio Code` for `Code Helper (Plugin)`). */
  appName: string | null;
  /** Safe to send an HTTP health check: dev servers and web services, never databases or system daemons. */
  probe: boolean;
  /** The Docker container that published this port, when the listener is the container runtime. */
  container: ContainerInfo | null;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  /** docker compose project, from the `com.docker.compose.project` label. */
  composeProject: string | null;
  /** Host address + port pairs it publishes. Address `*` = all interfaces (Docker's 0.0.0.0 / ::). */
  bindings: PortBinding[];
}

export interface PortBinding {
  address: string;
  port: number;
}

export interface StopResult {
  pid: number;
  port: number;
  outcome: StopOutcome;
  reason?: string;
}

export interface PlatformAdapter {
  listListeners(): Promise<Listener[]>;
  getProcesses(pids: number[]): Promise<Map<number, ProcessInfo>>;
  /** True while the pid exists and has not exited (a zombie counts as exited). */
  isRunning(pid: number): Promise<boolean>;
  openUrl(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Native yes/no dialog. Resolves true only when the user picks `confirmLabel`. */
  confirm(message: string, confirmLabel: string): Promise<boolean>;
  notify(title: string, message: string): Promise<void>;
  /** The service manager job running `pid`, if any. */
  findServiceJob(pid: number): Promise<ServiceJob | null>;
  /** Stops a service through its manager (password dialog when `job.needsAdmin`). */
  stopServiceJob(job: ServiceJob): Promise<{ outcome: AdminOutcome; message?: string }>;
  /**
   * SIGTERM to a process owned by another user, after the password dialog. The start-time check
   * runs inside the root command itself: the dialog can stay open long enough for the pid to be reused.
   */
  adminTerminate(pid: number, startedAt: Date): Promise<{ outcome: AdminOutcome; message?: string }>;
  /** Start `command` at login (logging to `logFile`), or stop doing so (null). */
  setStartAtLogin(item: { command: string[]; logFile: string } | null): void;
  isStartAtLogin(): boolean;
}

export const Reach = {
  Local: 'local',
  Network: 'network',
} as const;
export type Reach = (typeof Reach)[keyof typeof Reach];

export const Health = {
  /** Answered an HTTP request (any status). */
  Up: 'up',
  /** Accepted the connection but did not speak HTTP (databases, raw TCP). */
  NotHttp: 'not-http',
  /** Refused or timed out. */
  Down: 'down',
} as const;
export type Health = (typeof Health)[keyof typeof Health];

/** A service manager job that runs a process (launchd / Homebrew on macOS). */
export interface ServiceJob {
  label: string;
  /** Runs for the whole Mac, not just this user: stopping it asks for an admin password. */
  needsAdmin: boolean;
  /** The manager restarts it if the process alone is killed. */
  keepAlive: boolean;
  /** Homebrew formula, when it is a `brew services` job. */
  homebrewFormula: string | null;
}

export const AdminOutcome = {
  Done: 'done',
  /** The user clicked Cancel in the password dialog. */
  Cancelled: 'cancelled',
  Failed: 'failed',
} as const;
export type AdminOutcome = (typeof AdminOutcome)[keyof typeof AdminOutcome];
