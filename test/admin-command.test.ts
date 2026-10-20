import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { getPlatform } from '../src/platform/index.js';
import { adminTerminateCommand } from '../src/platform/darwin.js';
import { formatLstart, parseLstart } from '../src/platform/darwin-parse.js';

const isMac = process.platform === 'darwin';

/** Runs the exact text the root shell would get, as this user instead, against our own process. */
function sh(command: string): Promise<number> {
  return new Promise((resolve) => execFile('/bin/sh', ['-c', command], (error) => resolve(typeof error?.code === 'number' ? error.code : 0)));
}

test('formatLstart round-trips with parseLstart, single-spaced', () => {
  const date = new Date(2026, 9, 5, 9, 3, 7);
  assert.equal(formatLstart(date), 'Mon Oct 5 09:03:07 2026');
  assert.deepEqual(parseLstart(formatLstart(date).split(' ')), date);
});

test('admin command: kills only when the start time still matches', { skip: !isMac }, async () => {
  const child = spawn('sleep', ['30']);
  await sleep(200);
  const live = (await getPlatform().getProcesses([child.pid!])).get(child.pid!);
  assert.ok(live?.startedAt);

  const wrong = adminTerminateCommand(child.pid!, new Date(live.startedAt.getTime() - 60_000));
  assert.equal(await sh(wrong!), 1, 'a different start time: refuses');
  assert.equal(await getPlatform().isRunning(child.pid!), true);

  const exitCode = new Promise((resolve) => child.once('exit', (_code, signal) => resolve(signal)));
  assert.equal(await sh(adminTerminateCommand(child.pid!, live.startedAt)!), 0);
  assert.equal(await exitCode, 'SIGTERM');
});

test('admin command: nothing unsafe gets built', () => {
  assert.equal(adminTerminateCommand(1, new Date()), null, 'never launchd');
  assert.equal(adminTerminateCommand(12.5, new Date()), null);
  assert.equal(adminTerminateCommand(Number.NaN, new Date()), null);
  assert.equal(adminTerminateCommand(4242, new Date(Number.NaN)), null, 'an unreadable start time builds nothing');
});
