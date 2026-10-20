import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const cli = path.resolve(import.meta.dirname, '../src/cli/main.js');

/** Runs the CLI as a brand-new user: an empty home folder, so no settings and no tray. */
function runFresh(home: string, args: string[]): Promise<string> {
  return new Promise((resolve) =>
    execFile(process.execPath, [cli, ...args], { env: { ...process.env, HOME: home } }, (_error, stdout) => resolve(stdout)),
  );
}

test('first run: welcome once, then a tip about the menu bar while the tray is off', { skip: process.platform !== 'darwin' }, async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'portlight-fresh-'));
  const first = await runFresh(home, []);
  assert.match(first, /^Welcome to Portlight!/);
  assert.match(first, /portlight tray/);
  assert.match(first, /Tip: portlight tray puts this list in your menu bar\./);

  const second = await runFresh(home, []);
  assert.doesNotMatch(second, /Welcome to Portlight/, 'shown only once');
  assert.match(second, /Tip: portlight tray/);
});

test('--json output stays pure JSON, even on first run', { skip: process.platform !== 'darwin' }, async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'portlight-fresh-'));
  const out = await runFresh(home, ['ls', '--json']);
  assert.doesNotThrow(() => JSON.parse(out));
});

test('help starts with the three commands a new user needs', async () => {
  const out = await runFresh(mkdtempSync(path.join(os.tmpdir(), 'portlight-fresh-')), ['help']);
  const start = out.slice(out.indexOf('Start here'), out.indexOf('Free up a port'));
  for (const command of ['portlight ', 'portlight tray', 'portlight autostart on']) assert.ok(start.includes(command), command);
});

test('`portlight login` still works as the old name for autostart', { skip: process.platform !== 'darwin' }, async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'portlight-fresh-'));
  assert.match(await runFresh(home, ['login']), /^Autostart is off/);
  assert.match(await runFresh(home, ['autostart']), /^Autostart is off/);
});
