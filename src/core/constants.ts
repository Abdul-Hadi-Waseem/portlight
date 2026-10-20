export const STOP_GRACE_MS = 3000;
export const STOP_FORCE_WAIT_MS = 1000;
export const ALIVE_POLL_MS = 100;

export const LOCALHOST = 'localhost';

export const SYSTEM_PATH_PREFIXES = ['/System/', '/usr/libexec/', '/usr/sbin/', '/sbin/'] as const;
export const APP_PATH_MARKERS = ['/Applications/', '.app/Contents/'] as const;

/**
 * Container runtimes publish container ports from their own processes. Signalling one of these
 * would take down every container, so they are never stopped directly.
 */
export const CONTAINER_RUNTIME_NAMES = [
  'com.docker.backend',
  'com.docker.vpnkit',
  'vpnkit',
  'vpnkit-bridge',
  'OrbStack',
  'OrbStack Helper',
  'limactl',
  'colima',
  'gvproxy',
] as const;
export const CONTAINER_RUNTIME_PATH_MARKERS = ['/Docker.app/Contents/', '/OrbStack.app/Contents/'] as const;

export const ExitCode = {
  Ok: 0,
  Error: 1,
  Usage: 2,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1', 'localhost'] as const;

export const Signal = {
  Term: 'SIGTERM',
  Kill: 'SIGKILL',
  Continue: 'SIGCONT',
} as const;

/**
 * Every address family and scope a listener can sit on. A dual-stack `::` bind succeeds next to an
 * IPv4 `*` listener, so IPv4 and IPv6 wildcards are probed separately.
 */
export const PROBE_BINDS = [
  { host: '0.0.0.0' },
  { host: '127.0.0.1' },
  { host: '::', ipv6Only: true },
  { host: '::1' },
] as const;

/** How far up from a process's folder to look for package.json or .git. */
export const PROJECT_SEARCH_DEPTH = 6;
export const PACKAGE_JSON = 'package.json';
export const GIT_DIR = '.git';

/** package.json dependencies only say something about processes run by a JS runtime. */
export const JS_RUNTIME_NAMES = ['node', 'bun'] as const;

export const HEALTH_TIMEOUT_MS = 600;

/** Interpreters and runtimes that run dev servers, even when they live inside an .app bundle (Xcode's python3). */
export const DEV_RUNTIME_NAMES = [
  'node', 'bun', 'deno', 'python', 'python3', 'Python', 'ruby', 'php', 'java', 'go', 'beam.smp', 'dotnet', 'uvicorn', 'gunicorn',
] as const;

export const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Unicode control (Cc) and format (Cf) characters: escape sequences, bidi overrides, zero-width marks. */
export const UNSAFE_TEXT_PATTERN = /[\p{Cc}\p{Cf}]/gu;

export const WILDCARD_ADDRESSES = ['*', '0.0.0.0', '::'] as const;

/** Project lookups are cached per folder so the tray's 3 s refresh doesn't re-read package.json each time. */
export const PROJECT_CACHE_MS = 30_000;

/** The outermost `Name.app/Contents/` in a command line: the app a helper process belongs to. */
export const APP_BUNDLE_PATTERN = /\/([^/]+)\.app\/Contents\//;

export const DOCKER_BIN = 'docker';
export const DOCKER_COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
/** Seconds Docker waits for a container to exit after SIGTERM before killing it (Docker's own default). */
export const DOCKER_STOP_TIMEOUT_S = 10;
/** One published TCP entry of `docker ps` Ports: `0.0.0.0:8000-8001->8000-8001/tcp`, `[::]:5432->5432/tcp`. */
export const DOCKER_BINDING_PATTERN = /^\[?([^\]]*?)\]?:(\d+)(?:-(\d+))?->\d+(?:-\d+)?\/tcp$/;

/** `docker ps --format '{{json .}}'` row fields, plus how long to wait for it. */
export const DOCKER_PS_TIMEOUT_MS = 3000;
/** `docker stop` waits DOCKER_STOP_TIMEOUT_S for the container, then kills it; allow a margin on top. */
export const DOCKER_STOP_EXEC_TIMEOUT_MS = (DOCKER_STOP_TIMEOUT_S + 5) * 1000;

/** After `docker ps` times out, skip Docker for this long instead of paying the timeout on every scan. */
export const DOCKER_BACKOFF_MS = 30_000;
