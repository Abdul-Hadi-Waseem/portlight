import net from 'node:net';
import { PROBE_BINDS } from './constants.js';

type ProbeBind = (typeof PROBE_BINDS)[number];

/** Only EADDRINUSE means "taken": EACCES or EADDRNOTAVAIL (no IPv6) say nothing about the port. */
function canBind(port: number, bind: ProbeBind): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code !== 'EADDRINUSE'));
    server.listen({ port, exclusive: true, ...bind }, () => server.close(() => resolve(true)));
  });
}

/**
 * Last-resort check for sockets no scanner could attribute to a process: try to bind the port on
 * every wildcard and loopback address. EADDRINUSE on any of them means something holds it.
 */
export async function isPortBindable(port: number): Promise<boolean> {
  for (const bind of PROBE_BINDS) {
    if (!(await canBind(port, bind))) return false;
  }
  return true;
}
