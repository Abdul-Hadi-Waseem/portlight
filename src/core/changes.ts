import { displayName } from './scan.js';
import { isPrimary } from './sections.js';
import type { Server } from './types.js';

export interface ServerChanges {
  started: Server[];
  stopped: Server[];
}

/**
 * Identity for change tracking: port + name, not pid. A dev server that restarts itself on save
 * (nodemon, `next dev`) gets a new pid on the same port, which is not "stopped" plus "started".
 */
export function changeKey(server: Server): string {
  return `${server.port}|${displayName(server)}`;
}

/** A server must be missing from this many scans in a row before it counts as stopped. */
export const STOPPED_AFTER_MISSED_SCANS = 2;

/**
 * Turns successive scans into "started" / "stopped" events. Starts are reported at once; a stop
 * only after the server has been missing from several scans in a row, so a dev server that
 * restarts on save (gone for a moment, back on the same port) never reads as stopped + started.
 * The first scan sets the baseline: nothing already running is announced.
 */
export class ChangeTracker {
  #known: Map<string, Server> | null = null;
  #missed = new Map<string, number>();

  update(servers: Server[]): ServerChanges {
    const current = new Map(servers.filter(isPrimary).map((server) => [changeKey(server), server]));
    if (!this.#known) {
      this.#known = current;
      return { started: [], stopped: [] };
    }
    const started = [...current].filter(([key]) => !this.#known!.has(key)).map(([, server]) => server);
    for (const [key, server] of current) {
      this.#known.set(key, server);
      this.#missed.delete(key);
    }
    const stopped: Server[] = [];
    for (const [key, server] of this.#known) {
      if (current.has(key)) continue;
      const missed = (this.#missed.get(key) ?? 0) + 1;
      if (missed >= STOPPED_AFTER_MISSED_SCANS) {
        stopped.push(server);
        this.#known.delete(key);
        this.#missed.delete(key);
      } else this.#missed.set(key, missed);
    }
    return { started, stopped };
  }
}
