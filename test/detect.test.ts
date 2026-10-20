import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { detectFramework, findProject } from '../src/core/detect.js';
import { checkHealth } from '../src/core/health.js';
import { displayName } from '../src/core/scan.js';
import { groupServers } from '../src/core/sections.js';
import { Health, ServerKind, type Server } from '../src/core/types.js';

const label = (commandLine: string, name = 'node', deps: string[] = []) => detectFramework(commandLine, name, new Set(deps))?.label ?? null;

test('detectFramework recognises frameworks from the command line', () => {
  assert.equal(label('next-server (v15.0.3)'), 'Next.js');
  assert.equal(label('node /app/node_modules/next/dist/server/lib/start-server.js'), 'Next.js');
  assert.equal(label('node /app/node_modules/.bin/vite --port 5173'), 'Vite');
  assert.equal(label('node /app/node_modules/vite/bin/vite.js'), 'Vite');
  assert.equal(label('python manage.py runserver 8000', 'Python'), 'Django');
  assert.equal(label('/venv/bin/python /venv/bin/uvicorn main:app --reload', 'Python'), 'FastAPI');
  assert.equal(label('php artisan serve', 'php'), 'Laravel');
  assert.equal(label('php -S localhost:8000', 'php'), 'PHP');
  assert.equal(label('puma 6.4.2 (tcp://localhost:3000) [blog]', 'ruby'), 'Rails');
  assert.equal(label('/var/folders/x/T/go-build123/b001/exe/main', 'main'), 'Go');
  assert.equal(label('/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379', 'redis-server'), 'Redis');
});

test('detectFramework names Jenkins and kubectl port-forward, with what it forwards', () => {
  assert.equal(label('java -jar /opt/homebrew/opt/jenkins-lts/libexec/jenkins.war --httpPort=8080', 'java'), 'Jenkins');
  const rule = detectFramework('kubectl -n dev port-forward svc/api 8080:80', 'kubectl');
  assert.equal(rule?.label, 'kubectl');
  assert.equal(rule?.project?.('kubectl -n dev port-forward svc/api 8080:80'), 'svc/api');
  assert.equal(rule?.project?.('kubectl port-forward --address 0.0.0.0 pod/web-7d9 3000'), 'pod/web-7d9');
});

test('detectFramework does not trust folder names', () => {
  assert.equal(label('node /Users/hadi/vite-app/server.js'), null);
  assert.equal(label('node /Users/hadi/next-steps/index.js'), null);
});

test('detectFramework uses package.json deps only for JS runtimes', () => {
  assert.equal(label('node server.js', 'node', ['express']), 'Express');
  assert.equal(label('node server.js', 'node', ['next', 'express']), 'Next.js', 'framework deps win over server libs');
  assert.equal(label('python app.py', 'Python', ['express']), null);
});

test('findProject prefers package.json name, then git root, then the folder', () => {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'portlight-home-')));
  const web = path.join(home, 'repos', 'storefront', 'web');
  mkdirSync(path.join(web, 'src'), { recursive: true });
  writeFileSync(path.join(web, 'package.json'), JSON.stringify({ name: 'storefront', dependencies: { next: '15' } }));
  const api = path.join(home, 'repos', 'blog-api');
  mkdirSync(path.join(api, '.git'), { recursive: true });
  mkdirSync(path.join(api, 'app'));
  const loose = path.join(home, 'scratch');
  mkdirSync(loose);

  assert.deepEqual(findProject(path.join(web, 'src'), home), { name: 'storefront', root: web, deps: new Set(['next']) });
  assert.equal(findProject(path.join(api, 'app'), home)?.name, 'blog-api');
  assert.equal(findProject(loose, home)?.name, 'scratch');
  assert.equal(findProject(home, home), null);
  assert.equal(findProject('/', home), null);
  assert.equal(findProject(null, home), null);
});

test('displayName combines framework and project, but not for services', () => {
  const base = { processName: 'node', framework: null, project: null, kind: ServerKind.Dev };
  assert.equal(displayName({ ...base, framework: 'Next.js', project: 'storefront' }), 'Next.js · storefront');
  assert.equal(displayName({ ...base, project: 'scratch' }), 'node · scratch');
  assert.equal(displayName(base), 'node');
  assert.equal(displayName({ ...base, framework: 'PostgreSQL', project: 'data', kind: ServerKind.Service }), 'PostgreSQL');
});

test('checkHealth tells HTTP, non-HTTP and closed ports apart', async () => {
  const web = http.createServer((_, res) => res.end('ok'));
  const raw = net.createServer(() => {}); // accepts, never answers: like a database
  await Promise.all([web, raw].map((s) => new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve))));
  const portOf = (s: net.Server) => (s.address() as net.AddressInfo).port;

  assert.equal(await checkHealth({ port: portOf(web), addresses: ['127.0.0.1'] }), Health.Up);
  assert.equal(await checkHealth({ port: portOf(raw), addresses: ['127.0.0.1'] }, 200), Health.NotHttp);
  const closedPort = portOf(web);
  await new Promise((resolve) => web.close(resolve));
  raw.close();
  assert.equal(await checkHealth({ port: closedPort, addresses: ['127.0.0.1'] }), Health.Down);
});

test('groupServers orders sections and hides apps/system unless asked', () => {
  const server = (port: number, kind: ServerKind) => ({ port, kind }) as Server;
  const servers = [server(1, ServerKind.System), server(2, ServerKind.Service), server(3, ServerKind.Dev), server(4, ServerKind.App)];
  assert.deepEqual(groupServers(servers, false).map((g) => g.section.title), ['Dev servers', 'Services']);
  assert.deepEqual(groupServers(servers, true).map((g) => g.section.title), ['Dev servers', 'Services', 'Apps', 'System']);
});
