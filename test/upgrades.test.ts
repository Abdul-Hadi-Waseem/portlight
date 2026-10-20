import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ChangeTracker, changeKey } from '../src/core/changes.js';
import { customName, loadConfig, parseConfig, updateConfig } from '../src/core/config.js';
import { applyCustomNames, displayName } from '../src/core/scan.js';
import { ServerKind, type Server } from '../src/core/types.js';

const cli = path.resolve(import.meta.dirname, '../src/cli/main.js');
const isMac = process.platform === 'darwin';

function server(overrides: Partial<Server> = {}): Server {
  return {
    port: 3000, addresses: ['127.0.0.1'], pid: 100, processName: 'node', user: 'hadi', kind: ServerKind.Dev, cpuPercent: 0,
    memoryBytes: 0, startedAt: new Date(), commandLine: 'node gateway/server.js', cwd: '/x', framework: 'Express',
    project: 'api', appName: null, probe: true, container: null, ...overrides,
  };
}

test('config: keeps valid entries, drops broken ones, never throws', () => {
  const config = parseConfig({ names: { '9000': ' Payments API ', '9001': 42 }, rules: [{ match: 'gateway', name: 'Gateway' }, { match: '' }, 'x'], notifications: 'yes', editor: ' Cursor ' });
  assert.deepEqual(config, { names: { '9000': 'Payments API' }, rules: [{ match: 'gateway', name: 'Gateway' }], notifications: true, editor: 'Cursor' });
  assert.deepEqual(parseConfig('nonsense').names, {});
  const dir = mkdtempSync(path.join(os.tmpdir(), 'portlight-config-'));
  writeFileSync(path.join(dir, 'config.json'), '{ not json');
  assert.equal(loadConfig(path.join(dir, 'config.json')).notifications, true);
  assert.equal(loadConfig(path.join(dir, 'missing.json')).notifications, true);
});

test('config: custom names by port beat rules; rules match the command, case-insensitively', () => {
  const config = parseConfig({ names: { '9000': 'Payments API' }, rules: [{ match: 'GATEWAY', name: 'Gateway' }] });
  assert.equal(customName(config, 9000, 'node gateway.js'), 'Payments API');
  assert.equal(customName(config, 3000, 'node gateway/server.js'), 'Gateway');
  assert.equal(customName(config, 3000, 'node web.js'), null);
  const [named] = applyCustomNames([server()], config);
  assert.equal(displayName(named!), 'Express · Gateway');
});

test('config: updateConfig changes one setting and keeps the rest of the file', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'portlight-config-')), 'config.json');
  writeFileSync(file, JSON.stringify({ names: { '9000': 'Payments API' }, myOwnNote: 'keep me' }));
  updateConfig({ notifications: false }, file);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { names: { '9000': 'Payments API' }, myOwnNote: 'keep me', notifications: false });
});

test('changes: baseline is silent; starts are immediate; a restart on save is not a change', () => {
  const tracker = new ChangeTracker();
  assert.deepEqual(tracker.update([server({ pid: 100 })]), { started: [], stopped: [] }, 'what was already running is not announced');
  const vite = server({ port: 5173, project: 'web', framework: 'Vite' });
  assert.deepEqual(tracker.update([server({ pid: 200 }), vite]).started.map(changeKey), ['5173|Vite · web']);
  // the api restarts on save: gone for one scan, back with a new pid
  assert.deepEqual(tracker.update([vite]), { started: [], stopped: [] });
  assert.deepEqual(tracker.update([server({ pid: 300 }), vite]), { started: [], stopped: [] });
});

test('changes: a stop is reported once it has been missing two scans in a row; apps are ignored', () => {
  const tracker = new ChangeTracker();
  const app = server({ port: 49000, kind: ServerKind.App, processName: 'Code Helper' });
  tracker.update([server(), app]);
  assert.deepEqual(tracker.update([]).stopped, []);
  assert.deepEqual(tracker.update([]).stopped.map(changeKey), ['3000|Express · api']);
  assert.deepEqual(tracker.update([]).stopped, [], 'reported once');
});

function cliRun(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => execFile(process.execPath, [cli, ...args], (error, stdout) => resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout })));
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test('wait: returns as soon as something starts listening', async () => {
  const port = await freePort();
  const waiting = cliRun(['wait', String(port), '--timeout', '10']);
  setTimeout(() => net.createServer().listen(port, '127.0.0.1').unref(), 500);
  const { code, stdout } = await waiting;
  assert.equal(code, 0);
  assert.match(stdout, new RegExp(`Port ${port} is up`));
});

test('next: skips a port that is taken', { skip: !isMac }, async () => {
  const port = await freePort();
  const holder = net.createServer();
  await new Promise<void>((resolve) => holder.listen(port, '127.0.0.1', resolve));
  const { stdout } = await cliRun(['next', String(port)]);
  assert.ok(Number(stdout.trim()) > port);
  holder.close();
});

test('watch: shows a server starting and stopping', { skip: !isMac }, async () => {
  const watcher = spawn(process.execPath, [cli, 'watch'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  watcher.stdout.on('data', (d: Buffer) => (output += d));
  const until = async (pattern: RegExp) => {
    for (let i = 0; i < 60 && !pattern.test(output); i += 1) await new Promise((r) => setTimeout(r, 250));
    assert.match(output, pattern);
  };
  try {
    await until(/watching/);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'portlight-watch-'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'watch-demo' }));
    const demo = spawn(process.execPath, ['-e', "require('http').createServer().listen(0,'127.0.0.1')"], { cwd: dir });
    await until(/▲ started\s+node · watch-demo/);
    demo.kill('SIGTERM');
    await until(/▼ stopped\s+node · watch-demo/);
  } finally {
    watcher.kill('SIGTERM');
  }
});
