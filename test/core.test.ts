import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes, formatDuration, shortenHome } from '../src/cli/format.js';
import { buildServers, classify, reachOf } from '../src/core/scan.js';
import { refusalReason } from '../src/core/stop.js';
import { Reach, ServerKind, type ProcessInfo, type Server } from '../src/core/types.js';

const started = new Date(2026, 9, 20, 10, 0, 0);
const info = (overrides: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 101, ppid: 1, user: 'hadi', name: 'node', state: 'S', cpuPercent: 1, memoryBytes: 1024, startedAt: started,
  commandLine: 'node server.js', cwd: '/Users/hadi/app', ...overrides,
});

test('classify separates dev servers, apps and system processes', () => {
  assert.equal(classify(info(), 'hadi'), ServerKind.Dev);
  assert.equal(classify(info({ name: 'Spotify', commandLine: '/Applications/Spotify.app/Contents/MacOS/Spotify' }), 'hadi'), ServerKind.App);
  assert.equal(classify(info({ commandLine: '/usr/libexec/rapportd' }), 'hadi'), ServerKind.System);
  assert.equal(
    classify(info({ name: 'Python', commandLine: '/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python -m http.server' }), 'hadi'),
    ServerKind.Dev,
    "Xcode's python3 lives in an .app bundle but is a dev server",
  );
  assert.equal(classify(info({ user: 'root' }), 'hadi'), ServerKind.System);
  assert.equal(
    classify(info({ name: 'com.docker.backend', commandLine: '/Applications/Docker.app/Contents/MacOS/com.docker.backend services' }), 'hadi'),
    ServerKind.ContainerRuntime,
  );
  assert.equal(classify(info({ name: 'OrbStack Helper', commandLine: '/Applications/OrbStack.app/Contents/Frameworks/OrbStack Helper' }), 'hadi'), ServerKind.ContainerRuntime);
  assert.equal(classify(info({ name: 'node', commandLine: 'node /Users/hadi/colima-demo/server.js' }), 'hadi'), ServerKind.Dev, 'a folder name is not a runtime');
});

test('buildServers merges addresses per pid+port and sorts by port', () => {
  const servers = buildServers(
    [
      { pid: 101, port: 5173, address: '*', processName: 'node' },
      { pid: 101, port: 5173, address: '::1', processName: 'node' },
      { pid: 202, port: 3000, address: '127.0.0.1', processName: 'ruby' },
    ],
    new Map([[101, info()]]),
    'hadi',
  );
  assert.deepEqual(servers.map((s) => [s.port, s.addresses]), [[3000, ['127.0.0.1']], [5173, ['*', '::1']]]);
  assert.equal(servers[0]?.kind, ServerKind.System, 'unknown process details are treated as system');
  assert.equal(servers[1]?.cwd, '/Users/hadi/app');
  assert.equal(servers[0]?.processName, 'ruby', 'falls back to the listener name without process details');
});

test('reachOf flags anything not bound to loopback', () => {
  assert.equal(reachOf(['127.0.0.1', '::1']), Reach.Local);
  assert.equal(reachOf(['*']), Reach.Network);
  assert.equal(reachOf(['127.0.0.1', '192.168.1.4']), Reach.Network);
});

test('refusalReason only allows the exact same process owned by me', () => {
  const target = { pid: 101, startedAt: started, commandLine: 'node server.js' } as Server;
  assert.equal(refusalReason(target, info(), 'hadi'), null);
  assert.match(refusalReason(target, undefined, 'hadi') ?? '', /could not read/);
  assert.match(refusalReason(target, info({ user: '' }), 'hadi') ?? '', /could not read/, 'no ps row is not "another user"');
  assert.match(refusalReason(target, info({ user: 'root' }), 'hadi') ?? '', /owned by root/);
  assert.match(refusalReason(target, info({ commandLine: '/usr/libexec/rapportd' }), 'hadi') ?? '', /system process/);
  assert.match(refusalReason(target, info({ startedAt: new Date(2026, 9, 20, 11) }), 'hadi') ?? '', /different process/);
  assert.match(refusalReason(target, info({ commandLine: 'python app.py' }), 'hadi') ?? '', /different process/);
  assert.match(refusalReason(target, info({ startedAt: null }), 'hadi') ?? '', /start time/);
  assert.match(refusalReason(target, info({ name: 'com.docker.backend' }), 'hadi') ?? '', /docker stop/);
  assert.match(refusalReason({ ...target, startedAt: null }, info({ startedAt: null }), 'hadi') ?? '', /start time/, 'two missing start times must not count as a match');
});

test('formatters', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(180 * 1024 * 1024), '180 MB');
  assert.equal(formatDuration(30_000), '<1m');
  assert.equal(formatDuration((2 * 60 + 14) * 60_000), '2h 14m');
  assert.equal(formatDuration(26 * 3_600_000), '1d 2h');
  assert.equal(shortenHome('/Users/hadi/app', '/Users/hadi'), '~/app');
  assert.equal(shortenHome('C:\\Users\\hadi\\code\\app', 'C:\\Users\\hadi'), '~\\code\\app');
  assert.equal(shortenHome('/Users/hadiX', '/Users/hadi'), '/Users/hadiX');
});
