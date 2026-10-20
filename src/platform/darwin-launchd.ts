import { LAUNCHCTL_SERVICE_LINE, LAUNCHD_LABEL_SAFE, LAUNCHD_PATH_LINE } from './constants.js';
import { run } from './exec.js';

export const LaunchdDomain = {
  /** Started at boot for the whole Mac (/Library/LaunchDaemons): stopping needs an admin password. */
  System: 'system',
  /** The user's own login services (Homebrew's `brew services`): no password needed. */
  User: 'user',
} as const;
export type LaunchdDomain = (typeof LaunchdDomain)[keyof typeof LaunchdDomain];

export interface LaunchdJob {
  domain: LaunchdDomain;
  label: string;
  /** Restarted by launchd when it exits: killing the process alone would not stop it. */
  keepAlive: boolean;
}

/** `launchctl print <domain>` services block: `\t\t     538      - \tpostgresql-18` → 538 → postgresql-18. */
export function parseLaunchctlServices(output: string): Map<number, string> {
  const jobs = new Map<number, string>();
  for (const line of output.split('\n')) {
    const match = LAUNCHCTL_SERVICE_LINE.exec(line);
    const pid = Number(match?.[1]);
    if (match?.[2] && pid > 0) jobs.set(pid, match[2]);
  }
  return jobs;
}

export function domainTarget(domain: LaunchdDomain, uid: number = process.getuid?.() ?? 0): string {
  return domain === LaunchdDomain.System ? 'system' : `gui/${uid}`;
}

/** KeepAlive from the job's plist: `true`, or any conditions dict, means launchd restarts it. */
async function readKeepAlive(domain: LaunchdDomain, label: string): Promise<boolean> {
  const { stdout } = await run('launchctl', ['print', `${domainTarget(domain)}/${label}`]);
  const plistPath = LAUNCHD_PATH_LINE.exec(stdout)?.[1];
  if (!plistPath) return false;
  try {
    const { stdout: json, code } = await run('plutil', ['-convert', 'json', '-o', '-', plistPath]);
    if (code !== 0) return false;
    const keepAlive = (JSON.parse(json) as { KeepAlive?: unknown }).KeepAlive;
    return keepAlive === true || (typeof keepAlive === 'object' && keepAlive !== null);
  } catch {
    // Unreadable plist: assume the safer answer, that launchd would bring it back.
    return true;
  }
}

/** The launchd job that runs `pid`, if any: the user's own services first, then the system's. */
export async function findLaunchdJob(pid: number): Promise<LaunchdJob | null> {
  for (const domain of [LaunchdDomain.User, LaunchdDomain.System]) {
    const { stdout } = await run('launchctl', ['print', domainTarget(domain)]);
    const label = parseLaunchctlServices(stdout).get(pid);
    // Labels go into a shell command run as admin later: accept only plain reverse-DNS style names.
    if (label && LAUNCHD_LABEL_SAFE.test(label)) return { domain, label, keepAlive: await readKeepAlive(domain, label) };
  }
  return null;
}
