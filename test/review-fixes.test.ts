import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectFramework } from '../src/core/detect.js';
import { safeText, shortenHome } from '../src/core/format.js';
import { probeHost } from '../src/core/health.js';

const label = (commandLine: string, name = 'node', deps: string[] = []) => detectFramework(commandLine, name, new Set(deps))?.label ?? null;

test('safeText strips terminal escape sequences and bidi overrides from outside text', () => {
  assert.equal(safeText('app\u001b]52;c;aGk=\u0007\u001b[2K'), 'app]52;c;aGk=[2K');
  assert.equal(safeText('evil‮gnp.exe'), 'evilgnp.exe');
  assert.equal(safeText('storefront'), 'storefront');
  assert.equal(shortenHome('/Users/hadi/x\u001b[2Ky', '/Users/hadi'), '~/x[2Ky');
});

test('framework rules: specific beats generic', () => {
  assert.equal(label('java -Xms1g org.elasticsearch.bootstrap.Elasticsearch', 'java'), 'Elasticsearch');
  assert.equal(label('java -cp libs/* kafka.Kafka config/server.properties', 'java'), 'Kafka');
  assert.equal(label('java -jar app.jar', 'java'), 'Java');
  assert.equal(label('bun run dev', 'bun', ['next']), 'Next.js');
  assert.equal(label('bun server.ts', 'bun'), 'Bun');
  assert.equal(label('node /Users/hadi/repos/rabbitmq-dashboard/server.js'), null);
  assert.equal(label('beam.smp -- -root /opt -s rabbit boot -sname rabbit@localhost', 'beam.smp'), 'RabbitMQ');
});

test('probeHost reaches LAN-only listeners on their own address', () => {
  assert.equal(probeHost(['*']), '127.0.0.1');
  assert.equal(probeHost(['::']), '::1');
  assert.equal(probeHost(['127.0.0.1', '::1']), '127.0.0.1');
  assert.equal(probeHost(['192.168.1.4']), '192.168.1.4');
});
