import net from 'node:net';
import { PROBE_BINDS } from './constants.js';

type ProbeBind = (typeof PROBE_BINDS)[number];

/**
 * Error codes that mean "something already holds this port". Windows also answers EACCES when the
 * existing listener holds the port exclusively (and for ports Windows itself reserves): either way
 * the port can't be used. Elsewhere EACCES is about permissions, not the port, so it isn't counted.
 */
const IN_USE_CODES: readonly string[] = process.platform === 'win32' ? ['EADDRINUSE', 'EACCES'] : ['EADDRINUSE'];

/** EADDRNOTAVAIL (e.g. no IPv6 on this machine) says nothing about the port: counts as bindable. */
function canBind(port: number, bind: ProbeBind): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(!IN_USE_CODES.includes(error.code ?? '')));
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
