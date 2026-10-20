import { isPortBindable } from './probe.js';
import { scan } from './scan.js';
import type { PlatformAdapter } from './types.js';

export interface PortHolders {
  /** PIDs the scanners can see on the port. */
  pids: number[];
  /** Something holds the port that no scanner can attribute to a process. */
  hidden: boolean;
}

/** Who still holds `port`, after a stop: shared sockets can outlive the process that was stopped. */
export async function portHolders(platform: PlatformAdapter, port: number): Promise<PortHolders | null> {
  const pids = (await scan(platform)).filter((server) => server.port === port).map((server) => server.pid);
  if (pids.length > 0) return { pids, hidden: false };
  return (await isPortBindable(port)) ? null : { pids: [], hidden: true };
}
