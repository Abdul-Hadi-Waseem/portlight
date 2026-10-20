import http from 'node:http';
import { HEALTH_TIMEOUT_MS, LOOPBACK_ADDRESSES, WILDCARD_ADDRESSES } from './constants.js';
import { Health, type Server } from './types.js';

/**
 * An address that reaches this listener from this machine: loopback for wildcard or loopback
 * binds (IPv4 unless it only listens on IPv6), otherwise the specific address it is bound to.
 */
export function probeHost(addresses: string[]): string {
  const wildcard: readonly string[] = WILDCARD_ADDRESSES;
  const loopback: readonly string[] = LOOPBACK_ADDRESSES;
  const reachableLocally = addresses.filter((a) => wildcard.includes(a) || loopback.includes(a) || a.startsWith('127.'));
  if (reachableLocally.length > 0) return reachableLocally.every((a) => a.includes(':')) ? '::1' : '127.0.0.1';
  return addresses.find((a) => !a.includes(':')) ?? addresses[0] ?? '127.0.0.1';
}

/** One HEAD request to the server. Any HTTP response means "up", whatever the status code. */
export function checkHealth(server: Pick<Server, 'port' | 'addresses'>, timeoutMs: number = HEALTH_TIMEOUT_MS): Promise<Health> {
  return new Promise((resolve) => {
    let connected = false;
    const request = http.request(
      { host: probeHost(server.addresses), port: server.port, method: 'HEAD', path: '/', timeout: timeoutMs, agent: false },
      (response) => {
        response.resume();
        resolve(Health.Up);
      },
    );
    request.on('socket', (socket) => socket.once('connect', () => (connected = true)));
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve(connected ? Health.NotHttp : Health.Down));
    request.end();
  });
}

/** Checks only servers marked safe to probe; the rest get no entry. */
export async function checkAll(servers: Server[]): Promise<Map<Server, Health>> {
  const results = await Promise.all(servers.filter((server) => server.probe).map(async (server) => [server, await checkHealth(server)] as const));
  return new Map(results);
}
