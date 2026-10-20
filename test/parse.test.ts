import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeListeners, parseLsofCwd, parseLsofListeners, parseLstart, parseNetstatListeners, parsePs, parsePsComm, splitAddress, splitNetstatAddress } from '../src/platform/darwin-parse.js';

test('splitAddress handles IPv4, wildcard and bracketed IPv6', () => {
  assert.deepEqual(splitAddress('127.0.0.1:3000'), { address: '127.0.0.1', port: 3000 });
  assert.deepEqual(splitAddress('*:5173'), { address: '*', port: 5173 });
  assert.deepEqual(splitAddress('[::1]:8080'), { address: '::1', port: 8080 });
  assert.equal(splitAddress('no-port'), null);
  assert.equal(splitAddress('*:99999'), null);
});

test('parseLsofListeners reads pid/command/address and drops duplicate sockets', () => {
  const output = ['p101', 'cnode', 'f20', 'n*:3000', 'f21', 'n*:3000', 'f22', 'n[::1]:3000', 'p202', 'cCode Helper', 'f9', 'n127.0.0.1:49180', ''].join('\n');
  assert.deepEqual(parseLsofListeners(output), [
    { pid: 101, port: 3000, address: '*', processName: 'node' },
    { pid: 101, port: 3000, address: '::1', processName: 'node' },
    { pid: 202, port: 49180, address: '127.0.0.1', processName: 'Code Helper' },
  ]);
});

test('parseLstart reads the C-locale lstart format, including padded days', () => {
  assert.deepEqual(parseLstart(['Mon', 'Oct', '5', '09:03:07', '2026']), new Date(2026, 9, 5, 9, 3, 7));
  assert.equal(parseLstart(['Mon', 'Foo', '5', '09:03:07', '2026']), null);
});

test('parsePs keeps spaces inside the command', () => {
  const output = [
    '  101     1 hadi     S     2.5  20480 Tue Oct 20 18:15:54 2026     node /Users/hadi/My App/server.js --port 3000',
    ' 202   101 root     Ss+   0.0   1024 Mon Oct  5 09:03:07 2026     /usr/sbin/sshd -D',
    '',
  ].join('\n');
  const [first, second] = parsePs(output);
  assert.equal(first?.commandLine, 'node /Users/hadi/My App/server.js --port 3000');
  assert.equal(first?.memoryBytes, 20480 * 1024);
  assert.equal(first?.cpuPercent, 2.5);
  assert.deepEqual(first?.startedAt, new Date(2026, 9, 20, 18, 15, 54));
  assert.equal(first?.state, 'S');
  assert.equal(second?.user, 'root');
  assert.equal(second?.state, 'Ss+');
  assert.equal(second?.ppid, 101);
  assert.equal(second?.commandLine, '/usr/sbin/sshd -D');
});

test('parseLsofCwd maps pid to folder', () => {
  const output = ['p101', 'fcwd', 'n/Users/hadi/My App', 'p202', 'fcwd', 'n/', ''].join('\n');
  assert.deepEqual(parseLsofCwd(output), new Map([[101, '/Users/hadi/My App'], [202, '/']]));
});

test('splitNetstatAddress takes the port after the last dot', () => {
  assert.deepEqual(splitNetstatAddress('*.5432'), { address: '*', port: 5432 });
  assert.deepEqual(splitNetstatAddress('127.0.0.1.3000'), { address: '127.0.0.1', port: 3000 });
  assert.deepEqual(splitNetstatAddress('::1.8080'), { address: '::1', port: 8080 });
  assert.equal(splitNetstatAddress('*.*'), null);
});

test('parseNetstatListeners reads other users\' sockets, names with spaces, and skips non-LISTEN rows', () => {
  const output = [
    'Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)          rxbytes      txbytes  rhiwat  shiwat          process:pid    state  options',
    'tcp4       0      0  *.5432                 *.*                    LISTEN                 0            0  131072  131072         postgres:538    00000 00000006',
    'tcp6       0      0  *.5432                 *.*                    LISTEN                 0            0  131072  131072         postgres:538    00000 00000006',
    'tcp4       0      0  127.0.0.1.49203        *.*                    LISTEN                 0            0  131072  131072 Code Helper (Plu:3191   00100 00000106',
    'tcp4       0      0  192.168.1.4.52000      17.57.146.20.443       ESTABLISHED            0            0  131072  131072           Safari:900    00100 00000106',
    '',
  ].join('\n');
  assert.deepEqual(parseNetstatListeners(output), [
    { pid: 538, port: 5432, address: '*', processName: 'postgres' },
    { pid: 3191, port: 49203, address: '127.0.0.1', processName: 'Code Helper (Plu' },
  ]);
});

test('parsePsComm keeps the executable basename, spaces included', () => {
  const output = '  538 /opt/homebrew/opt/postgresql@16/bin/postgres\n 3191 /Applications/Code.app/Contents/MacOS/Code Helper (Plugin)\n';
  assert.deepEqual(parsePsComm(output), new Map([[538, 'postgres'], [3191, 'Code Helper (Plugin)']]));
});

test('mergeListeners keeps other-user sockets from netstat and shared-socket workers from lsof', () => {
  const netstat = [
    { pid: 538, port: 5432, address: '*', processName: 'postgres' },
    { pid: 700, port: 8000, address: '127.0.0.1', processName: 'python3' },
  ];
  const lsof = [
    { pid: 700, port: 8000, address: '127.0.0.1', processName: 'Python' },
    { pid: 701, port: 8000, address: '127.0.0.1', processName: 'Python' },
  ];
  assert.deepEqual(mergeListeners(netstat, lsof).map((l) => [l.pid, l.port]), [[538, 5432], [700, 8000], [701, 8000]]);
});
