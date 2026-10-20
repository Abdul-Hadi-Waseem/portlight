import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentUser } from '../src/core/scan.js';
import { refusalReason } from '../src/core/stop.js';
import { canStopAsAdmin, stopRefusal, stopTarget } from '../src/core/stop-target.js';
import { AdminOutcome, ServerKind, StopOutcome, type PlatformAdapter, type ProcessInfo, type Server, type ServiceJob } from '../src/core/types.js';
import { parseLaunchctlServices } from '../src/platform/darwin-launchd.js';

const me = currentUser();
const started = new Date(2026, 9, 20, 9);

function server(overrides: Partial<Server> = {}): Server {
  return {
    port: 5432, addresses: ['*'], pid: 538, processName: 'postgres', user: 'postgres', kind: ServerKind.Service,
    cpuPercent: 0, memoryBytes: 0, startedAt: started, commandLine: '/Library/PostgreSQL/18/bin/postgres -D /Library/PostgreSQL/18/data',
    cwd: null, framework: 'PostgreSQL', project: null, appName: null, probe: false, container: null, ...overrides,
  };
}

const live = (s: Server): ProcessInfo => ({
  pid: s.pid, ppid: 1, user: s.user, name: s.processName, state: 'S', cpuPercent: 0, memoryBytes: 0,
  startedAt: s.startedAt, commandLine: s.commandLine, cwd: null,
});

/** What was done, without the process reads. */
const actions = (calls: string[]) => calls.filter((call) => !call.startsWith('read '));

/** Fake Mac: one process that "exits" once something stops it; records what was asked. */
function fakePlatform(target: Server, job: ServiceJob | null, admin: AdminOutcome = AdminOutcome.Done) {
  const calls: string[] = [];
  let running = true;
  const platform = {
    isRunning: async () => running,
    getProcesses: async (_pids: number[], options?: { fresh?: boolean }) => {
      calls.push(options?.fresh ? 'read fresh' : 'read cached');
      return new Map([[target.pid, live(target)]]);
    },
    findServiceJob: async () => job,
    stopServiceJob: async (j: ServiceJob) => {
      calls.push(`service ${j.homebrewFormula ? `brew:${j.homebrewFormula}` : j.label}${j.needsAdmin ? ' (password)' : ''}`);
      if (admin === AdminOutcome.Done) running = false;
      return { outcome: admin };
    },
    adminTerminate: async (pid: number) => {
      calls.push(`admin-term ${pid}`);
      if (admin === AdminOutcome.Done) running = false;
      return { outcome: admin };
    },
  } as unknown as PlatformAdapter;
  return { platform, calls };
}

test('parseLaunchctlServices maps running pids to labels', () => {
  const output = ['\tservices = {', '\t\t    1283   (pe) \tcom.apple.syncdefaultsd', '\t\t     538      - \tpostgresql-18', '\t\t       0      - \tcom.apple.idle', '\t}'].join('\n');
  assert.deepEqual(parseLaunchctlServices(output), new Map([[1283, 'com.apple.syncdefaultsd'], [538, 'postgresql-18']]));
});

test("another user's database can be stopped with a password; macOS and unknown daemons still can't", () => {
  assert.equal(stopRefusal(server(), me), null);
  assert.equal(canStopAsAdmin(server({ kind: ServerKind.System, processName: 'warp-svc' })), false);
  assert.match(stopRefusal(server({ kind: ServerKind.System, processName: 'warp-svc', framework: null }), me) ?? '', /owned by/);
  const rapportd = server({ processName: 'rapportd', user: me, kind: ServerKind.System, commandLine: '/usr/libexec/rapportd', framework: null });
  assert.match(stopRefusal(rapportd, me) ?? '', /system process/);
  const rootSystem = server({ user: 'root', commandLine: '/usr/sbin/httpd -D FOREGROUND', processName: 'httpd' });
  assert.match(refusalReason(rootSystem, live(rootSystem), me, { allowOtherUser: true }) ?? '', /system process/, 'macOS paths stay off-limits even with a password');
});

test('a system launchd service (EDB PostgreSQL) is stopped through launchd, with the password dialog', async () => {
  const target = server();
  const { platform, calls: allCalls } = fakePlatform(target, { label: 'postgresql-18', needsAdmin: true, keepAlive: false, homebrewFormula: null });
  assert.equal((await stopTarget(platform, target, { graceMs: 200 })).outcome, StopOutcome.Stopped);
  assert.deepEqual(actions(allCalls), ['service postgresql-18 (password)']);
});

test('a Homebrew service goes through brew services stop, no password', async () => {
  const target = server({ user: me, commandLine: '/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379', processName: 'redis-server', framework: 'Redis' });
  const { platform, calls: allCalls } = fakePlatform(target, { label: 'homebrew.mxcl.redis', needsAdmin: false, keepAlive: true, homebrewFormula: 'redis' });
  assert.equal((await stopTarget(platform, target, { graceMs: 200 })).outcome, StopOutcome.Stopped);
  assert.deepEqual(actions(allCalls), ['service brew:redis']);
});

test("a sudo-run dev server from your folders, no service manager: SIGTERM after the password", async () => {
  const os = await import('node:os');
  const target = server({ processName: 'node', kind: ServerKind.Dev, framework: null, commandLine: 'node server.js', user: 'root', cwd: `${os.homedir()}/code/api` });
  const { platform, calls: allCalls } = fakePlatform(target, null);
  assert.equal((await stopTarget(platform, target, { graceMs: 200 })).outcome, StopOutcome.Stopped);
  assert.deepEqual(actions(allCalls), ['admin-term 538']);
});

test('Cancel in the password dialog is reported as cancelled, not as an error', async () => {
  const target = server();
  const { platform } = fakePlatform(target, { label: 'postgresql-18', needsAdmin: true, keepAlive: false, homebrewFormula: null }, AdminOutcome.Cancelled);
  assert.equal((await stopTarget(platform, target, { graceMs: 200 })).outcome, StopOutcome.Cancelled);
});

test('a changed process is refused before any password dialog', async () => {
  const target = server();
  const { platform, calls: allCalls } = fakePlatform({ ...target, startedAt: new Date(2026, 9, 21) }, null);
  assert.equal((await stopTarget(platform, target)).outcome, StopOutcome.Refused);
  assert.deepEqual(actions(allCalls), []);
});

test("a vendor agent on a dev runtime (root python from /) is never offered, even with a password", () => {
  const agent = server({ processName: 'python3', kind: ServerKind.Dev, framework: null, user: 'root', cwd: '/', commandLine: '/usr/bin/python3 /Library/Application Support/VendorVPN/agent.py' });
  assert.equal(canStopAsAdmin(agent), false);
  assert.match(stopRefusal(agent, me) ?? '', /owned by root/);
});

test("another user's recognised service with no service manager and not in your folders is refused at stop time", async () => {
  const target = server({ cwd: '/' });
  const { platform, calls: allCalls } = fakePlatform(target, null);
  const result = await stopTarget(platform, target);
  assert.equal(result.outcome, StopOutcome.Refused);
  assert.deepEqual(actions(allCalls), [], 'no password dialog was shown');
});

test('every check right before stopping reads the process fresh, never from the scan', async () => {
  const target = server();
  const { platform, calls } = fakePlatform(target, { label: 'postgresql-18', needsAdmin: true, keepAlive: false, homebrewFormula: null });
  await stopTarget(platform, target, { graceMs: 200 });
  const reads = calls.filter((call) => call.startsWith('read '));
  assert.ok(reads.length > 0);
  assert.deepEqual(new Set(reads), new Set(['read fresh']));
});
