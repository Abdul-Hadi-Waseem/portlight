import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectImage, imageRepo } from '../src/core/images.js';
import { attachContainers } from '../src/core/scan.js';
import { stopRefusal, stopKey } from '../src/core/stop-target.js';
import { ServerKind, type Server } from '../src/core/types.js';
import { parseBindings, parseDockerPs } from '../src/sources/docker.js';

test('parseBindings keeps addresses, merges 0.0.0.0/:: as *, expands ranges, skips udp/unpublished', () => {
  assert.deepEqual(parseBindings('0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp'), [{ address: '*', port: 5432 }]);
  assert.deepEqual(parseBindings('127.0.0.1:8000-8001->8000-8001/tcp'), [
    { address: '127.0.0.1', port: 8000 },
    { address: '127.0.0.1', port: 8001 },
  ]);
  assert.deepEqual(parseBindings('80/tcp, 192.168.1.5:6379->6379/tcp, 0.0.0.0:53->53/udp'), [{ address: '192.168.1.5', port: 6379 }]);
  assert.deepEqual(parseBindings('[::1]:9000->9000/tcp'), [{ address: '::1', port: 9000 }]);
  assert.deepEqual(parseBindings(''), []);
});

test('parseDockerPs reads names, images and the compose project', () => {
  const output = [
    JSON.stringify({ ID: 'abc', Names: 'shop-db-1', Image: 'postgres:16-alpine', Ports: '0.0.0.0:5433->5432/tcp', Labels: 'com.docker.compose.project=shop,com.docker.compose.service=db' }),
    JSON.stringify({ ID: 'def', Names: 'scratch', Image: 'nginx', Ports: '0.0.0.0:8080->80/tcp', Labels: '' }),
    'not json',
    '',
  ].join('\n');
  assert.deepEqual(parseDockerPs(output), [
    { id: 'abc', name: 'shop-db-1', image: 'postgres:16-alpine', composeProject: 'shop', bindings: [{ address: '*', port: 5433 }] },
    { id: 'def', name: 'scratch', image: 'nginx', composeProject: null, bindings: [{ address: '*', port: 8080 }] },
  ]);
});

test('image names', () => {
  assert.equal(imageRepo('docker.io/library/postgres:16-alpine'), 'postgres');
  assert.equal(imageRepo('ghcr.io/org/api@sha256:abc'), 'api');
  assert.equal(imageRepo('localhost:5000/team/web:dev'), 'web');
  assert.deepEqual(detectImage('bitnami/redis:7'), { label: 'Redis', service: true });
  assert.deepEqual(detectImage('nginx:1.27'), { label: 'nginx', service: false });
  assert.deepEqual(detectImage('my-company/checkout-api:latest'), { label: 'checkout-api', service: false });
  assert.deepEqual(detectImage('kindest/node:v1.31.0'), { label: 'Kubernetes (kind)', service: true });
  assert.deepEqual(detectImage('node:20-alpine'), { label: 'node', service: false }, 'Node.js is not Kubernetes');
  assert.deepEqual(detectImage('gcr.io/k8s-minikube/kicbase:v0.0.45'), { label: 'Kubernetes (minikube)', service: true });
  assert.equal(detectImage('jenkins/jenkins:lts').label, 'Jenkins');
  assert.deepEqual(detectImage('bitnami/postgresql:16'), { label: 'PostgreSQL', service: true });
  assert.deepEqual(detectImage('mcr.microsoft.com/mssql/server:2022-latest'), { label: 'SQL Server', service: true });
});

const runtime = (port: number): Server => ({
  port, addresses: ['*'], pid: 2737, processName: 'com.docker.backend', user: 'hadi', kind: ServerKind.ContainerRuntime,
  cpuPercent: 0, memoryBytes: 0, startedAt: new Date(), commandLine: '/Applications/Docker.app/Contents/MacOS/com.docker.backend',
  cwd: '/', framework: 'Docker', project: null, appName: 'Docker', probe: false, container: null,
});

test('attachContainers turns runtime ports into named containers; unmatched ones stay runtime', () => {
  const containers = parseDockerPs(JSON.stringify({ ID: 'abc', Names: 'shop-db-1', Image: 'postgres:16', Ports: '0.0.0.0:5433->5432/tcp', Labels: 'com.docker.compose.project=shop' }));
  const [db, other] = attachContainers([runtime(5433), runtime(41000)], containers);
  assert.equal(db?.kind, ServerKind.Container);
  assert.equal(db?.framework, 'PostgreSQL');
  assert.equal(db?.project, 'shop');
  assert.equal(db?.probe, false, 'databases in containers get no HTTP requests either');
  assert.equal(other?.kind, ServerKind.ContainerRuntime);
});

test('containers are stoppable via docker, but the runtime itself never is', () => {
  const containers = parseDockerPs(JSON.stringify({ ID: 'abc', Names: 'web', Image: 'nginx', Ports: '0.0.0.0:8080->80/tcp' }));
  const [web, bare] = attachContainers([runtime(8080), runtime(41000)], containers);
  assert.equal(stopRefusal(web!, 'hadi'), null);
  assert.match(stopRefusal(bare!, 'hadi') ?? '', /container runtime/);
  assert.notEqual(stopKey(web!), stopKey({ ...web!, container: { ...web!.container!, id: 'other' } }), 'two containers on one runtime pid are two stops');
});

test('two containers on one port number, different addresses: one row each, never the wrong one', () => {
  const containers = [
    ...parseDockerPs(JSON.stringify({ ID: 'a', Names: 'web-a', Image: 'nginx', Ports: '127.0.0.1:8080->80/tcp' })),
    ...parseDockerPs(JSON.stringify({ ID: 'b', Names: 'db-b', Image: 'postgres', Ports: '192.168.1.5:8080->5432/tcp' })),
  ];
  const rows = attachContainers([{ ...runtime(8080), addresses: ['127.0.0.1', '192.168.1.5'] }], containers);
  assert.deepEqual(rows.map((r) => [r.container?.name, r.addresses]), [['web-a', ['127.0.0.1']], ['db-b', ['192.168.1.5']]]);
  assert.notEqual(stopKey(rows[0]!), stopKey(rows[1]!));
});

test('ambiguous container match stays the runtime and cannot be stopped', () => {
  const containers = [
    ...parseDockerPs(JSON.stringify({ ID: 'a', Names: 'one', Image: 'nginx', Ports: '10.0.0.1:8080->80/tcp' })),
    ...parseDockerPs(JSON.stringify({ ID: 'b', Names: 'two', Image: 'nginx', Ports: '10.0.0.2:8080->80/tcp' })),
  ];
  const [row] = attachContainers([{ ...runtime(8080), addresses: ['*'] }], containers);
  assert.equal(row?.kind, ServerKind.ContainerRuntime);
  assert.match(stopRefusal(row!, 'hadi') ?? '', /container runtime/);
});

test('a hung docker daemon costs at most a few seconds and reads as "no containers"', { skip: process.platform === 'win32' }, async () => {
  const { chmodSync, mkdtempSync, writeFileSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { listContainers } = await import('../src/sources/docker.js');
  const bin = mkdtempSync(path.join(os.tmpdir(), 'portlight-fake-docker-'));
  writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexec sleep 30\n'); // exec: the timeout kills sleep itself, nothing is left behind
  chmodSync(path.join(bin, 'docker'), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ''}`;
  try {
    const started = Date.now();
    assert.deepEqual(await listContainers(), []);
    assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
    const again = Date.now();
    assert.deepEqual(await listContainers(), []);
    assert.ok(Date.now() - again < 500, 'a hung daemon is skipped for a while instead of costing 3 s every scan');
  } finally {
    process.env.PATH = originalPath;
  }
});
