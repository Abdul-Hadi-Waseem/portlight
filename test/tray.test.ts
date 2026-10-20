import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { MenuItem } from '@trayjs/trayjs';
import { Health, ServerKind, type PlatformAdapter, type Server } from '../src/core/types.js';
import { getPlatform } from '../src/platform/index.js';
import { buildMenu, parseMenuId, serverKey } from '../src/tray/menu.js';
import { createTrayController } from '../src/tray/tray.js';

const isMac = process.platform === 'darwin';
const children: ChildProcess[] = [];
after(() => children.forEach((child) => child.kill('SIGKILL')));

const started = new Date(2026, 9, 20, 10, 0, 0);
function server(port: number, kind: ServerKind, overrides: Partial<Server> = {}): Server {
  return {
    port, kind, pid: port * 10, addresses: ['127.0.0.1'], processName: 'node', user: 'hadi', cpuPercent: 1.5,
    memoryBytes: 180 * 1024 * 1024, startedAt: started, commandLine: 'node server.js', cwd: '/Users/hadi/repos/web',
    framework: null, project: null, appName: null, probe: true, container: null, ...overrides,
  };
}

const titles = (items: MenuItem[]) => items.filter((item) => !item.separator).map((item) => item.title);
const allIds = (items: MenuItem[]): string[] => items.flatMap((item) => [item.id, ...allIds(item.items ?? [])]);

test('buildMenu: sections, health dots, names, and secondary ports tucked away', () => {
  const next = server(3000, ServerKind.Dev, { framework: 'Next.js', project: 'storefront' });
  const pg = server(5432, ServerKind.Service, { framework: 'PostgreSQL', user: 'postgres' });
  const sys = server(63928, ServerKind.System, { processName: 'rapportd' });
  const menu = buildMenu({
    servers: [next, pg, sys],
    health: new Map([[next, Health.Up], [pg, Health.NotHttp]]),
    refusals: new Map([[serverKey(pg), 'owned by postgres'], [serverKey(sys), 'system process']]),
    now: started.getTime() + 2 * 3_600_000,
    startAtLogin: false,
  });

  assert.deepEqual(titles(menu), [
    'DEV SERVERS',
    '🟢  storefront — Next.js · 3000',
    'SERVICES',
    '⚪  PostgreSQL · 5432',
    'Other ports (1)',
    'Start at login',
    'Quit Portlight',
  ]);
  const ids = allIds(menu);
  assert.equal(new Set(ids).size, ids.length, 'every menu item id is unique');

  const nextItems = menu.find((item) => item.title?.endsWith(' · 3000'))?.items ?? [];
  assert.ok(titles(nextItems).includes('up 2h 0m · local only'));
  assert.ok(titles(nextItems).includes('Next.js · node · 180 MB'));
  assert.ok(nextItems.some((item) => item.title === 'Stop storefront…' && item.enabled !== false));
  const pgItems = menu.find((item) => item.title?.endsWith(' · 5432'))?.items ?? [];
  assert.ok(pgItems.some((item) => item.title === "Can't stop: owned by postgres" && item.enabled === false));
  const pgRow = menu.find((item) => item.title?.endsWith(' · 5432'));
  assert.match(pgRow?.tooltip ?? '', /^A PostgreSQL database server\. It runs as "postgres", not as you\./, 'hover says what it is and why');
  assert.equal(menu.find((item) => item.title?.endsWith(' · 3000'))?.tooltip, undefined, 'stoppable rows need no excuse');
  assert.ok(!pgItems.some((item) => item.title?.startsWith('Stop')));
  assert.ok(!pgItems.some((item) => item.title?.startsWith('Open')), 'no browser link for a database');
});

test('buildMenu says so when nothing is running', () => {
  const menu = buildMenu({ servers: [], health: new Map(), refusals: new Map(), now: Date.now(), startAtLogin: false });
  assert.deepEqual(titles(menu), ['Nothing you started is listening', 'Start at login', 'Quit Portlight']);
});

test('parseMenuId', () => {
  assert.deepEqual(parseMenuId('stop:123:3000'), { action: 'stop', key: '123:3000' });
  assert.deepEqual(parseMenuId('quit'), { action: 'quit', key: null });
});

/** Real scanning and stopping; the dialog, clipboard, browser and notifications are recorded instead. */
function fakeUi(confirmAnswer: boolean) {
  const calls: string[] = [];
  const platform: PlatformAdapter = {
    ...getPlatform(),
    openUrl: async (url) => void calls.push(`open ${url}`),
    copyText: async (text) => void calls.push(`copy ${text}`),
    confirm: async (message) => (calls.push(`confirm ${message.split('\n')[0]}`), confirmAnswer),
    notify: async (_title, message) => void calls.push(`notify ${message}`),
    // Never touch the real ~/Library/LaunchAgents from tests.
    setStartAtLogin: (item) => void calls.push(`login ${item ? 'on' : 'off'}`),
    isStartAtLogin: () => false,
  };
  return { platform, calls };
}

function startProject(): Promise<{ port: number; child: ChildProcess }> {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'portlight-tray-')));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'tray-demo', dependencies: { express: '5' } }));
  const code = "const s=require('node:http').createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>console.log(s.address().port))";
  const child = spawn(process.execPath, ['-e', code], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  return new Promise((resolve) => child.stdout?.once('data', (d: Buffer) => resolve({ port: Number(String(d).trim()), child })));
}

function findItem(menu: MenuItem[], port: number): MenuItem | undefined {
  return menu.find((item) => item.title?.endsWith(` · ${port}`));
}

test('controller: a real server appears with its name and health, and its actions work', { skip: !isMac }, async () => {
  const { port, child } = await startProject();
  const { platform, calls } = fakeUi(true);
  const controller = createTrayController(platform);

  const item = findItem(await controller.menu(true), port);
  assert.equal(item?.title, `🟢  tray-demo — Express · ${port}`);
  const action = (title: string) => item?.items?.find((sub) => sub.title?.startsWith(title))?.id ?? '';

  await controller.click(action('Open localhost'));
  await controller.click(action('Copy URL'));
  await controller.click(action('Copy PID'));
  assert.deepEqual(calls, [`open http://localhost:${port}`, `copy http://localhost:${port}`, `copy ${child.pid}`]);

  calls.length = 0;
  await controller.click(action('Stop'));
  assert.equal(calls[0], `confirm Stop Express · tray-demo on port ${port}?`);
  assert.equal(calls[1], `notify Stopped Express · tray-demo on port ${port}.`);
  assert.equal(findItem(await controller.menu(false), port), undefined, 'gone from the menu after stopping');
});

test('controller: Cancel in the dialog leaves the server running', { skip: !isMac }, async () => {
  const { port } = await startProject();
  const { platform, calls } = fakeUi(false);
  const controller = createTrayController(platform);
  const stopId = findItem(await controller.menu(true), port)?.items?.find((sub) => sub.title?.startsWith('Stop'))?.id ?? '';
  await controller.click(stopId);
  assert.equal(calls.length, 1, 'only the confirm dialog, no stop, no notification');
  assert.ok(findItem(await controller.menu(false), port));
});

test('controller: Quit returns true', async () => {
  assert.equal(await createTrayController(fakeUi(true).platform).click('quit'), true);
});

test('buildMenu: other ports are grouped by app, explained, and read-only', () => {
  const vscode = (port: number) =>
    server(port, ServerKind.App, {
      processName: 'Code Helper (Plugin)',
      appName: 'Visual Studio Code',
      cwd: '/',
      probe: false,
      commandLine: '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
    });
  const rapportd = server(54232, ServerKind.System, { processName: 'rapportd', addresses: ['*'], probe: false });
  const menu = buildMenu({ servers: [vscode(49175), vscode(49202), rapportd], health: new Map(), refusals: new Map(), now: Date.now(), startAtLogin: false });

  const other = menu.find((item) => item.title === 'Other ports (3)');
  assert.deepEqual(titles(other?.items ?? []), ['Visual Studio Code · 2 ports', 'macOS · AirDrop & Handoff · 1 port']);
  const code = titles(other?.items?.[0]?.items ?? []);
  assert.ok(code[0]?.startsWith("VS Code's extensions"), 'explains what it is first');
  assert.ok(code[0]?.includes('\n'), 'the explanation is one item with line breaks, so it highlights as one block');
  assert.match(other?.items?.[0]?.tooltip ?? '', /^VS Code's extensions.*Quit Visual Studio Code to close it\.$/);
  assert.match(other?.items?.[1]?.tooltip ?? '', /AirDrop.*It is part of macOS\. Leave it running\./);
  assert.ok(code.includes(':49175 · Code Helper (Plugin) · local only'));
  const everything = allIds(other?.items ?? []);
  assert.ok(!everything.some((id) => /^(stop|open|copy-url):/.test(id)), 'no actions on apps or system ports');
});

test('a dev server started from / shows no folder line', () => {
  const menu = buildMenu({ servers: [server(3000, ServerKind.Dev, { cwd: '/' })], health: new Map(), refusals: new Map(), now: Date.now(), startAtLogin: false });
  assert.ok(!titles(menu.find((item) => item.title?.endsWith(' · 3000'))?.items ?? []).includes('/'));
});

test('controller: the Start at login item toggles the login item', async () => {
  const { platform, calls } = fakeUi(true);
  await createTrayController(platform).click('toggle-login');
  assert.deepEqual(calls, ['login on']);
});

test('controller: clicking an info line, header or group does nothing (no "no longer running")', async () => {
  const { platform, calls } = fakeUi(true);
  const controller = createTrayController(platform);
  for (const id of ['info-7', 'sep-3', 'group-2', 'header-1', 'server-4']) assert.equal(await controller.click(id), false);
  assert.deepEqual(calls, []);
});

test('controller: a real action on a server that has gone does say so', async () => {
  const { platform, calls } = fakeUi(true);
  await createTrayController(platform).click('stop:999999:1');
  assert.deepEqual(calls, ['notify That server is no longer running.']);
});
