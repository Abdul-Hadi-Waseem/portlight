import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { isLoginItemEnabled, launchAgentFile, setLoginItem } from '../src/platform/darwin-login.js';

test('login item: written as a valid plist with absolute paths, removed when turned off', { skip: process.platform !== 'darwin' }, () => {
  const file = launchAgentFile(mkdtempSync(path.join(os.tmpdir(), 'portlight-agents-')));
  const item = {
    programArguments: ['/Users/me/.nvm/versions/node/v24/bin/node', '/Users/me/my <tools> & "stuff"/main.js', 'tray', '--foreground'],
    path: '/opt/homebrew/bin:/usr/local/bin:/usr/bin',
    logFile: '/Users/me/.config/portlight/tray.log',
  };
  setLoginItem(item, file);
  assert.equal(isLoginItemEnabled(file), true);
  // plutil is macOS's own plist validator: proves the XML (and its escaping) is well-formed.
  execFileSync('plutil', ['-lint', file]);
  const json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' })) as Record<string, unknown>;
  assert.equal(json.Label, 'dev.portlight.tray');
  assert.deepEqual(json.ProgramArguments, item.programArguments);
  assert.deepEqual(json.EnvironmentVariables, { PATH: item.path });
  assert.equal(json.RunAtLoad, true);
  assert.ok(readFileSync(file, 'utf8').includes('&amp;'));

  setLoginItem(null, file);
  assert.equal(isLoginItemEnabled(file), false);
});

test('login item refuses temporary npx copies', async () => {
  const { isEphemeralInstall } = await import('../src/tray/daemon.js');
  assert.equal(isEphemeralInstall('/Users/me/.npm/_npx/1a2b3c/node_modules/portlight/dist/src/cli/main.js'), true);
  assert.equal(isEphemeralInstall(path.join(os.tmpdir(), 'x', 'main.js')), true);
  assert.equal(isEphemeralInstall('/Users/me/Library/Caches/pnpm/dlx/abc/node_modules/portlight/dist/src/cli/main.js'), true);
  assert.equal(isEphemeralInstall('/opt/homebrew/lib/node_modules/portlight/dist/src/cli/main.js'), false);
});
