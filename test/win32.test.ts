import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { projectFromCommand, splitCommandLine } from '../src/core/detect.js';
import { classify } from '../src/core/scan.js';
import { ServerKind } from '../src/core/types.js';
import { encodePowerShell } from '../src/platform/win32.js';
import { asRows, normalizeWinAddress, parseWinListeners, parseWinProcesses, stripExe } from '../src/platform/win32-parse.js';
import { stopServiceScript, terminateScript } from '../src/platform/win32-scripts.js';

test('PowerShell JSON: one object or an array, always rows', () => {
  assert.deepEqual(asRows({ a: 1 }), [{ a: 1 }]);
  assert.deepEqual(asRows([{ a: 1 }, { a: 2 }]), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(asRows(null), []);
});

test('Windows listeners: wildcard addresses become *, the kernel and bad rows are dropped', () => {
  const rows = [
    { address: '0.0.0.0', port: 3000, pid: 8120 },
    { address: '::', port: 3000, pid: 8120 },
    { address: '127.0.0.1', port: 5432, pid: 3100 },
    { address: '0.0.0.0', port: 445, pid: 4 },
    { address: '0.0.0.0', port: 135, pid: 0 },
    { address: '0.0.0.0', port: 'x', pid: 1 },
  ];
  assert.deepEqual(parseWinListeners(rows, new Map([[8120, 'node']])), [
    { pid: 8120, port: 3000, address: '*', processName: 'node' },
    { pid: 3100, port: 5432, address: '127.0.0.1', processName: '3100' },
  ]);
  assert.equal(normalizeWinAddress('::1'), '::1');
  assert.equal(stripExe('node.EXE'), 'node');
});

test('Windows processes: names without .exe, UTC start times, no cwd; services may hide their details', () => {
  const processes = parseWinProcesses([
    { pid: 8120, ppid: 7000, name: 'node.exe', cmd: '"C:\\\\Program Files\\\\nodejs\\\\node.exe" C:\\\\code\\\\shop\\\\server.js', created: '2026-10-21T09:15:02.123Z', mem: 52428800, user: 'hadi' },
    { pid: 3100, ppid: 700, name: 'postgres.exe', cmd: null, created: null, mem: 1, user: null },
    { pid: 9, created: 'yesterday' },
  ]);
  const node = processes.get(8120);
  assert.equal(node?.name, 'node');
  assert.equal(node?.user, 'hadi');
  assert.deepEqual(node?.startedAt, new Date(Date.UTC(2026, 9, 21, 9, 15, 2, 123)));
  assert.equal(node?.cwd, null);
  assert.equal(processes.get(3100)?.commandLine, '');
  assert.equal(processes.get(9)?.startedAt, null, 'an unexpected date format is not trusted');
});

test('PowerShell -EncodedCommand is base64 of UTF-16LE', () => {
  assert.equal(Buffer.from(encodePowerShell("Write-Output 'é'"), 'base64').toString('utf16le'), "Write-Output 'é'");
});

test('elevated scripts are built only from validated parts', () => {
  assert.equal(stopServiceScript('postgresql-x64-16'), "Stop-Service -Name 'postgresql-x64-16' -Force -ErrorAction Stop");
  const script = terminateScript(8120, '2026-10-21T09:15:02.123Z');
  assert.match(script, /Get-Process -Id 8120/);
  assert.match(script, /-ne '2026-10-21T09:15:02\.123Z'\) \{ exit 3 \}/, 'checks the start time inside the elevated shell');
});

test('splitCommandLine keeps quoted Windows paths together', () => {
  assert.deepEqual(splitCommandLine('"C:\\Program Files\\nodejs\\node.exe" C:\\code\\shop\\server.js --port 3000'), [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\code\\shop\\server.js',
    '--port',
    '3000',
  ]);
});

test('projectFromCommand: the folder above node_modules, or the script\'s project; never npm itself', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'portlight-cmd-'));
  const shop = path.join(home, 'code', 'shop');
  mkdirSync(path.join(shop, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(path.join(shop, 'package.json'), JSON.stringify({ name: 'shop', dependencies: { next: '15' } }));
  const npmGlobal = path.join(home, 'nodejs', 'node_modules', 'npm', 'bin');
  mkdirSync(npmGlobal, { recursive: true });
  writeFileSync(path.join(home, 'nodejs', 'node_modules', 'npm', 'package.json'), JSON.stringify({ name: 'npm' }));

  assert.equal(projectFromCommand(`node ${path.join(shop, 'node_modules', '.bin', 'vite')} --port 5173`, home)?.name, 'shop');
  assert.equal(projectFromCommand(`node ${path.join(shop, 'server.js')}`, home)?.name, 'shop');
  assert.equal(projectFromCommand(`node ${path.join(npmGlobal, 'npm-cli.js')} run dev`, home), null, "npm's own package is not the project");
  assert.equal(projectFromCommand('node -e "require(1)"', home), null);
});

test('Windows paths: C:\\Windows is the system, Program Files and AppData Programs are apps, node stays dev', () => {
  const info = (name: string, commandLine: string) => ({ user: 'hadi', name, commandLine });
  assert.equal(classify(info('svchost', 'C:\\WINDOWS\\system32\\svchost.exe -k LocalService'), 'hadi'), ServerKind.System);
  assert.equal(classify(info('Code', '"C:\\Users\\hadi\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" --type=utility'), 'hadi'), ServerKind.App);
  assert.equal(classify(info('Spotify', '"C:\\Program Files\\Spotify\\Spotify.exe"'), 'hadi'), ServerKind.App);
  assert.equal(classify(info('node', '"C:\\Program Files\\nodejs\\node.exe" server.js'), 'hadi'), ServerKind.Dev, 'a dev runtime even from Program Files');
});
