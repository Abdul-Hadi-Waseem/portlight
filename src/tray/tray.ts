import { fileURLToPath } from 'node:url';
import { Tray, type MenuItem } from '@trayjs/trayjs';
import { checkHealth } from '../core/health.js';
import { portHolders } from '../core/port-check.js';
import { currentUser, displayName, scan } from '../core/scan.js';
import { describeStop, needsPassword, stopRefusal, stopTarget } from '../core/stop-target.js';
import { StopOutcome, type Health, type PlatformAdapter, type Server } from '../core/types.js';
import { HEALTH_CACHE_MS, MenuAction, SERVER_ACTIONS, NOTIFY_TITLE, TRAY_ICON_ICO, TRAY_ICON_PNG, TRAY_REFRESH_MS, TRAY_TOOLTIP } from './constants.js';
import { setTrayAtLogin } from './daemon.js';
import { buildMenu, parseMenuId, serverKey, urlFor } from './menu.js';

interface CachedHealth {
  health: Health;
  checkedAt: number;
}

/** Health cache keyed by pid:port plus start time, so a new process on the same pid/port is re-checked. */
function healthKey(server: Server): string {
  return `${serverKey(server)}:${server.startedAt?.getTime() ?? 0}`;
}

export interface TrayController {
  /** Fresh menu. `checkServers` also runs (cached) health checks: true when the user opens the menu. */
  menu(checkServers: boolean): Promise<MenuItem[]>;
  /** Handles a menu click. Returns true when the user chose Quit. */
  click(id: string): Promise<boolean>;
}

/** Everything the tray does, without the native tray: testable with a fake platform. */
export function createTrayController(platform: PlatformAdapter): TrayController {
  const healthCache = new Map<string, CachedHealth>();
  let snapshot = new Map<string, Server>();
  // Separate slots: opening the menu (with health) must not reuse a background build (without).
  const inflight = new Map<boolean, Promise<MenuItem[]>>();

  async function healthFor(servers: Server[], refresh: boolean): Promise<Map<Server, Health>> {
    const now = Date.now();
    const entries = await Promise.all(
      servers.filter((server) => server.probe).map(async (server) => {
        const cached = healthCache.get(healthKey(server));
        if (cached && (!refresh || now - cached.checkedAt < HEALTH_CACHE_MS)) return [server, cached.health] as const;
        if (!refresh) return null;
        const health = await checkHealth(server);
        healthCache.set(healthKey(server), { health, checkedAt: now });
        return [server, health] as const;
      }),
    );
    return new Map(entries.filter((entry) => entry !== null));
  }

  async function build(checkServers: boolean): Promise<MenuItem[]> {
    const servers = await scan(platform);
    const me = currentUser();
    const refusals = new Map<string, string>();
    const passwordNeeded = new Set<string>();
    for (const server of servers) {
      const reason = stopRefusal(server, me);
      if (reason) refusals.set(serverKey(server), reason);
      else if (needsPassword(server, me)) passwordNeeded.add(serverKey(server));
    }
    snapshot = new Map(servers.map((server) => [serverKey(server), server]));
    return buildMenu({
      servers,
      health: await healthFor(servers, checkServers),
      refusals,
      needsPassword: passwordNeeded,
      now: Date.now(),
      startAtLogin: platform.isStartAtLogin(),
    });
  }

  /** One build per kind at a time; a request mid-build shares it. Errors become a menu line. */
  function menu(checkServers: boolean): Promise<MenuItem[]> {
    const pending = inflight.get(checkServers);
    if (pending) return pending;
    const next = build(checkServers)
      .catch((error: unknown): MenuItem[] => [
        { id: MenuAction.Info, title: `Scan failed: ${error instanceof Error ? error.message : String(error)}`, enabled: false },
        { id: MenuAction.Quit, title: 'Quit Portlight' },
      ])
      .finally(() => inflight.delete(checkServers));
    inflight.set(checkServers, next);
    return next;
  }

  async function stop(server: Server): Promise<void> {
    const name = `${displayName(server)} on port ${server.port}`;
    const details = await describeStop(platform, server);
    if (!(await platform.confirm(`Stop ${name}?\n\n${details}`, 'Stop'))) return;

    const result = await stopTarget(platform, server);
    if (result.outcome === StopOutcome.Cancelled) return;
    if (result.outcome === StopOutcome.Refused || result.outcome === StopOutcome.Failed) {
      await platform.notify(NOTIFY_TITLE, `Could not stop ${name}: ${result.reason ?? result.outcome}`);
      return;
    }
    const holders = await portHolders(platform, server.port);
    const message = holders
      ? `Stopped PID ${server.pid}, but port ${server.port} is still held by ${holders.hidden ? 'a hidden process' : `PID ${holders.pids.join(', ')}`}.`
      : `Stopped ${name}.`;
    await platform.notify(NOTIFY_TITLE, message);
  }

  async function click(id: string): Promise<boolean> {
    const { action, key } = parseMenuId(id);
    if (action === MenuAction.Quit) return true;
    if (action === MenuAction.ToggleLogin) {
      try {
        setTrayAtLogin(platform, !platform.isStartAtLogin());
      } catch (error) {
        await platform.notify(NOTIFY_TITLE, (error as Error).message);
      }
      return false;
    }
    // Info lines can't be disabled in the native submenus (see menu.ts), so they do get clicked:
    // anything that isn't a server action is ignored quietly.
    if (!SERVER_ACTIONS.includes(action) || !key) return false;
    const server = snapshot.get(key);
    if (!server) {
      // The menu on screen was older than the latest scan: that server has gone since.
      await platform.notify(NOTIFY_TITLE, 'That server is no longer running.');
      return false;
    }
    try {
      if (action === MenuAction.Open) await platform.openUrl(urlFor(server));
      else if (action === MenuAction.CopyUrl) await platform.copyText(urlFor(server));
      else if (action === MenuAction.CopyPid) await platform.copyText(String(server.pid));
      else if (action === MenuAction.CopyContainer && server.container) await platform.copyText(server.container.name);
      else if (action === MenuAction.Stop) await stop(server);
    } catch (error) {
      await platform.notify(NOTIFY_TITLE, error instanceof Error ? error.message : String(error));
    }
    return false;
  }

  return { menu, click };
}

/**
 * The native side rebuilds the whole menu (removeAllItems) on every setMenu, even while it is
 * open, which collapses the submenu under the user's mouse. And it doesn't report when the menu
 * closes. So the menu is never replaced while it might be open:
 * - every few seconds the next menu is prepared in memory only;
 * - when the user opens the menu, the prepared one is returned at once (before they can reach a
 *   submenu), then a fresh one with health checks is prepared for the next open;
 * - after a click the menu has closed, so it is safe to set it again.
 */
export function runTray(platform: PlatformAdapter): Promise<void> {
  const controller = createTrayController(platform);
  let prepared: MenuItem[] = [{ id: MenuAction.Info, title: 'Scanning…', enabled: false }];
  // Builds can overlap; only a build that started after the one on display may replace it.
  let started = 0;
  let shown = 0;
  const prepare = async (checkServers: boolean) => {
    const generation = (started += 1);
    const items = await controller.menu(checkServers);
    if (generation > shown) {
      shown = generation;
      prepared = items;
    }
    return prepared;
  };

  return new Promise((resolve) => {
    const tray = new Tray({
      icon: { png: fileURLToPath(TRAY_ICON_PNG), ico: fileURLToPath(TRAY_ICON_ICO) },
      tooltip: TRAY_TOOLTIP,
      onMenuRequested: () => {
        const items = prepared;
        void prepare(true);
        return items;
      },
      onClicked: (id) =>
        void controller.click(id).then(async (quit) => {
          if (quit) tray.quit();
          else tray.setMenu(await prepare(false));
        }),
    });

    tray.on('ready', () => void prepare(true).then((items) => tray.setMenu(items)));
    const timer = setInterval(() => void prepare(false), TRAY_REFRESH_MS);
    tray.on('close', () => {
      clearInterval(timer);
      resolve();
    });
  });
}
