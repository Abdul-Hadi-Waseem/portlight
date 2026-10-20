import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';
import net from 'node:net';
import { isPortBindable } from '../src/core/probe.js';
import { scan } from '../src/core/scan.js';
import { stopServer } from '../src/core/stop.js';
import { StopOutcome, type Server } from '../src/core/types.js';
import { getPlatform } from '../src/platform/index.js';

const isMac = process.platform === 'darwin';
const platform = isMac ? getPlatform() : null;
const children: ChildProcess[] = [];
const groups: number[] = [];
after(() => {
  children.forEach((child) => child.kill('SIGKILL'));
  for (const pgid of groups) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      // group already gone
    }
  }
});

const isRunning = (pid: number) => platform!.isRunning(pid);

/**
 * Starts a real HTTP server on a free port in a temp folder and resolves once it is listening.
 * `underNonReapingParent` runs it under a shell that execs `sleep`, so when the server dies it
 * stays a zombie: the way a process looks when its parent does not wait() for it.
 */
function startServer(
  { ignoreSigterm = false, underNonReapingParent = false } = {},
): Promise<{ child: ChildProcess; port: number; cwd: string }> {
  const cwd = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'portlight-test-')));
  const code = `${ignoreSigterm ? "process.on('SIGTERM', () => {});" : ''}
    const s = require('node:http').createServer((q, r) => r.end('ok'));
    s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;
  const child = underNonReapingParent
    ? spawn('/bin/sh', ['-c', `"${process.execPath}" -e "$0" & exec sleep 60`, code], { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
    : spawn(process.execPath, ['-e', code], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  return new Promise((resolve, reject) => {
    child.stdout?.once('data', (data: Buffer) => resolve({ child, port: Number(String(data).trim()), cwd }));
    child.once('error', reject);
  });
}

async function findServer(port: number): Promise<Server> {
  const server = (await scan(platform!)).find((s) => s.port === port);
  assert.ok(server, `expected a server on port ${port}`);
  return server;
}

test('scan finds a real server with its pid, folder and command', { skip: !isMac }, async () => {
  const { child, port, cwd } = await startServer();
  const server = await findServer(port);
  assert.equal(server.pid, child.pid);
  assert.equal(server.cwd, cwd);
  assert.match(server.commandLine, /node.* -e /);
  assert.ok(server.startedAt instanceof Date);
});

test('stopServer stops politely with SIGTERM', { skip: !isMac }, async () => {
  const { port } = await startServer();
  const server = await findServer(port);
  const result = await stopServer(platform!, server);
  assert.equal(result.outcome, StopOutcome.Stopped);
  assert.equal(await isRunning(server.pid), false);
});

test('stopServer resumes a suspended (Ctrl-Z) server so SIGTERM works', { skip: !isMac }, async () => {
  const { child, port } = await startServer();
  const server = await findServer(port);
  child.kill('SIGSTOP');
  const result = await stopServer(platform!, server, { graceMs: 1500 });
  assert.equal(result.outcome, StopOutcome.Stopped);
});

test('stopServer counts a server that exits into a zombie as stopped', { skip: !isMac }, async () => {
  const { port } = await startServer({ underNonReapingParent: true });
  const server = await findServer(port);
  const result = await stopServer(platform!, server, { graceMs: 1500 });
  assert.equal(result.outcome, StopOutcome.Stopped);
});

test('stopServer escalates to SIGKILL when SIGTERM is ignored', { skip: !isMac }, async () => {
  const { port } = await startServer({ ignoreSigterm: true });
  const server = await findServer(port);
  const result = await stopServer(platform!, server, { graceMs: 300 });
  assert.equal(result.outcome, StopOutcome.Forced);
  assert.equal(await isRunning(server.pid), false);
});

test('stopServer refuses when the pid now belongs to a different process', { skip: !isMac }, async () => {
  const { port } = await startServer();
  const server = await findServer(port);
  const stale: Server = { ...server, startedAt: new Date(0) };
  const result = await stopServer(platform!, stale);
  assert.equal(result.outcome, StopOutcome.Refused);
  assert.equal(await isRunning(server.pid), true, 'the live process must be left alone');
});

test('stopServer reports a process that already exited', { skip: !isMac }, async () => {
  const { child, port } = await startServer();
  const server = await findServer(port);
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  assert.equal((await stopServer(platform!, server)).outcome, StopOutcome.AlreadyGone);
});

/** A prefork server: the parent opens the socket, two forked workers share it. netstat only names the parent. */
const PREFORK_SERVER = `
import os, socket, sys, time
s = socket.socket(); s.bind(('127.0.0.1', 0)); s.listen()
print(s.getsockname()[1], flush=True)
for _ in range(2):
    if os.fork() == 0:
        time.sleep(60); sys.exit(0)
time.sleep(60)
`;

const hasPython = await promisify(execFile)('python3', ['--version']).then(() => true, () => false);

test('CLI: free stops every process sharing a prefork socket and confirms the port is released', { skip: !isMac || !hasPython }, async () => {
  // Own process group, so a failing test can still kill the workers (they would hold our stdout pipe open).
  const parent = spawn('python3', ['-c', PREFORK_SERVER], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
  groups.push(parent.pid!);
  const port = await new Promise<number>((resolve) => parent.stdout?.once('data', (data: Buffer) => resolve(Number(String(data).trim()))));
  await new Promise((resolve) => setTimeout(resolve, 200));

  const holders = (await scan(platform!)).filter((s) => s.port === port);
  assert.equal(new Set(holders.map((s) => s.pid)).size, 3, 'parent and both workers are listed');

  const freed = await runCli(['free', String(port), '-y']);
  assert.equal(freed.code, 0, freed.stdout);
  assert.equal(await isPortBindable(port), true);
});

for (const host of ['127.0.0.1', '0.0.0.0', '::1', '::']) {
  test(`isPortBindable sees a port held on ${host} without any scanner`, async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const { port } = server.address() as net.AddressInfo;
    assert.equal(await isPortBindable(port), false);
    await new Promise((resolve) => server.close(resolve));
    assert.equal(await isPortBindable(port), true);
  });
}

const cli = path.resolve(import.meta.dirname, '../src/cli/main.js');

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], (error, stdout, stderr) => {
      resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
    });
  });
}

test('CLI rejects loose arguments with the usage exit code', async () => {
  for (const args of [['open', '0x50'], ['kill', '1e3'], ['kill', '3000', 'extra'], ['free', '--pid', '1'], ['kill', '70000'], ['bogus'], ['--bogus']]) {
    assert.equal((await runCli(args)).code, 2, `expected usage error for: ${args.join(' ')}`);
  }
});

test('CLI: ls --json lists the server and free -y frees the port', { skip: !isMac }, async () => {
  const run = promisify(execFile);
  const { port } = await startServer();

  const list = JSON.parse((await run(process.execPath, [cli, 'ls', '--json'])).stdout) as Server[];
  assert.ok(list.some((s) => s.port === port));

  const freed = await run(process.execPath, [cli, 'free', String(port), '-y']);
  assert.match(freed.stdout, /stopped/);
  assert.match((await run(process.execPath, [cli, 'free', String(port)])).stdout, new RegExp(`Port ${port} is free`));
});

test('tray pid file: a pid now used by another process is ignored and the file removed', { skip: !isMac }, async () => {
  const { writeTrayRecord, runningTrayPid } = await import('../src/tray/daemon.js');
  const { TRAY_PID_FILE } = await import('../src/tray/constants.js');
  const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
  const backup = existsSync(TRAY_PID_FILE) ? readFileSync(TRAY_PID_FILE, 'utf8') : null;
  try {
    const { child } = await startServer(); // a live process of ours that is NOT the tray
    writeTrayRecord({ pid: child.pid!, startedAt: Date.now() });
    assert.equal(await runningTrayPid(platform!), null);
    assert.equal(existsSync(TRAY_PID_FILE), false, 'stale record removed');
  } finally {
    if (backup !== null) writeFileSync(TRAY_PID_FILE, backup);
  }
});
