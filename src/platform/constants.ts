export const EXEC_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
/** Forces English month names and `.` decimals so ps/lstart output is parseable on any locale. */
export const EXEC_LOCALE = 'C';

export const LSTART_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `ps -o pid=,ppid=,user=,stat=,%cpu=,rss=,lstart=,command=`: 6 fields + 5 lstart tokens precede the command. */
export const PS_FIELDS = 'pid=,ppid=,user=,stat=,%cpu=,rss=,lstart=,command=';
export const PS_LEADING_TOKENS = 11;
export const PS_COMMAND_PATTERN = new RegExp(`^\\s*(?:\\S+\\s+){${PS_LEADING_TOKENS}}(.*)$`);

/** ps `stat` starting with Z: exited but not yet reaped by its parent. Holds no sockets. */
export const ZOMBIE_STATE_PREFIX = 'Z';

/**
 * A LISTEN row of `netstat -anv -p tcp` on macOS:
 * `tcp4  0  0  *.5432  *.*  LISTEN  0  0  131072  131072  postgres:538  00000 ...`
 * The process column is right-aligned and may contain spaces (`Code Helper (Plu:23027`).
 */
export const NETSTAT_LISTEN_PATTERN = /^tcp[46]\s+\d+\s+\d+\s+(\S+)\s+\S+\s+LISTEN\s+\d+\s+\d+\s+\d+\s+\d+\s+(.*?):(\d+)\s/;

/** launchd job label; also the LaunchAgent file name. */
export const LAUNCH_AGENT_LABEL = 'dev.portlight.tray';

/** Upper bound for any external command (lsof, ps, netstat…), so nothing can hang a scan or the tray. */
export const EXEC_TIMEOUT_MS = 10_000;

/** A line in a `launchctl print` services block: pid, last exit status, label. */
export const LAUNCHCTL_SERVICE_LINE = /^\s+(\d+)\s+\S+\s+(\S+)\s*$/;
/** `path = /Library/LaunchDaemons/x.plist` in `launchctl print <domain>/<label>`. */
export const LAUNCHD_PATH_LINE = /^\s*path = (.+\.plist)\s*$/m;
/** Labels safe to put into a command: reverse-DNS characters, plus Homebrew's `@` and `+` (`postgresql@16`). */
export const LAUNCHD_LABEL_SAFE = /^[A-Za-z0-9][A-Za-z0-9@+._-]*$/;
/** A Homebrew formula name; never starting with `-`, so it can't be read as a brew option. */
export const HOMEBREW_FORMULA_SAFE = /^[A-Za-z0-9][A-Za-z0-9@+._-]*$/;
/** ps `lstart` text, normalised to single spaces: `Tue Oct 20 18:15:54 2026`. Safe inside single quotes. */
export const LSTART_TEXT_SAFE = /^[A-Za-z0-9: ]+$/;
/** Never stopped, even with a password: Apple's own launchd jobs. */
export const APPLE_LABEL_PREFIX = 'com.apple.';
/** Homebrew names its service jobs `homebrew.mxcl.<formula>`. */
export const HOMEBREW_LABEL_PREFIX = 'homebrew.mxcl.';

/** osascript's error when the user clicks Cancel in a dialog. */
export const OSASCRIPT_USER_CANCELLED = '(-128)';
