import type { MenuItem } from '@trayjs/trayjs';
import { LOCALHOST } from '../core/constants.js';
import { cannotStopHint, explain, nameParts, reachOf } from '../core/scan.js';
import { groupServers, isPrimary } from '../core/sections.js';
import { Health, Reach, type Server } from '../core/types.js';
import { formatBytes, formatDuration, shortenHome, wrapText } from '../core/format.js';
import { HEALTH_EMOJI, MENU_TEXT_WIDTH, MenuAction } from './constants.js';

export interface MenuState {
  servers: Server[];
  health: Map<Server, Health>;
  /** Why a server can't be stopped (system, other user, container runtime), keyed like `serverKey`. */
  refusals: Map<string, string>;
  /** Servers whose Stop will show the macOS password dialog, keyed like `serverKey`. */
  needsPassword?: Set<string>;
  now: number;
  startAtLogin: boolean;
}

/** Unique per row: two containers can share the runtime's pid and a port number. */
export function serverKey(server: Pick<Server, 'pid' | 'port'> & { container?: { id: string } | null }): string {
  return server.container ? `${server.pid}:${server.port}:${server.container.id}` : `${server.pid}:${server.port}`;
}

export function menuId(action: MenuAction, server?: Pick<Server, 'pid' | 'port' | 'container'>): string {
  return server ? `${action}:${serverKey(server)}` : action;
}

export function parseMenuId(id: string): { action: string; key: string | null } {
  const [action = '', ...rest] = id.split(':');
  return { action, key: rest.length > 0 ? rest.join(':') : null };
}

/** Hands out unique ids for items that are never clicked (separators, info lines). */
function idFactory() {
  let count = 0;
  return (prefix: string) => `${prefix}-${(count += 1)}`;
}
type NextId = ReturnType<typeof idFactory>;

function separator(nextId: NextId): MenuItem {
  return { id: nextId(MenuAction.Separator), separator: true };
}

function info(nextId: NextId, title: string): MenuItem {
  return { id: nextId(MenuAction.Info), title, enabled: false };
}

function serverItem(server: Server, state: MenuState, nextId: NextId): MenuItem {
  const health = state.health.get(server);
  const { name, detail } = nameParts(server);
  const reach = reachOf(server.addresses) === Reach.Network ? 'reachable from your network' : 'local only';
  const uptime = server.startedAt && !server.container ? `up ${formatDuration(state.now - server.startedAt.getTime())}` : null;
  const refusal = state.refusals.get(serverKey(server));

  // Only servers that may be probed (dev servers, web services) get links; a database has no page.
  const web: MenuItem[] =
    !server.probe || health === Health.NotHttp
      ? []
      : [
          { id: menuId(MenuAction.Open, server), title: `Open localhost:${server.port}` },
          { id: menuId(MenuAction.CopyUrl, server), title: 'Copy URL' },
        ];
  const container = server.container;
  const copy: MenuItem = container
    ? { id: menuId(MenuAction.CopyContainer, server), title: `Copy container name (${container.name})` }
    : { id: menuId(MenuAction.CopyPid, server), title: `Copy PID ${server.pid}` };
  // A container's memory/PID belong to the runtime, not the container: show the image instead.
  const facts = container
    ? [container.image, `container ${container.name}`]
    : [detail, server.processName !== detail ? server.processName : null, formatBytes(server.memoryBytes)];
  const items: MenuItem[] = [
    ...web,
    copy,
    separator(nextId),
    info(nextId, facts.filter(Boolean).join(' · ')),
    info(nextId, [uptime, reach].filter(Boolean).join(' · ')),
  ];
  if (server.cwd && server.cwd !== '/') items.push(info(nextId, shortenHome(server.cwd)));
  items.push(separator(nextId));
  const hint = refusal ? cannotStopHint(server, refusal) : undefined;
  items.push(
    refusal
      ? { ...info(nextId, `Can't stop: ${refusal}`), tooltip: hint }
      : {
          id: menuId(MenuAction.Stop, server),
          title: state.needsPassword?.has(serverKey(server)) ? `Stop ${name}… (asks for your password)` : `Stop ${name}…`,
        },
  );

  const title = [name, detail].filter(Boolean).join(' — ');
  return { id: nextId(MenuAction.Server), title: `${HEALTH_EMOJI[health ?? Health.NotHttp]}  ${title} · ${server.port}`, tooltip: hint, items };
}

/**
 * Ports opened by apps and macOS, one entry per app ("Visual Studio Code · 8 ports"), each with a
 * plain-language line saying what it is. Read-only: no Stop, Open or status dot.
 */
function otherGroups(others: Server[], nextId: NextId): MenuItem[] {
  const groups = new Map<string, Server[]>();
  for (const server of others) {
    const name = nameParts(server).name;
    groups.set(name, [...(groups.get(name) ?? []), server]);
  }
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .map(([name, servers]) => {
      const first = servers[0]!;
      const explanation = explain(first);
      // One item with line breaks, not one item per line: the native tray can't disable items in
      // submenus (macOS auto-enables them), so separate lines would each highlight on hover.
      const lines = explanation ? [info(nextId, wrapText(explanation, MENU_TEXT_WIDTH).join('\n'))] : [];
      const ports = servers.map((server) => ({
        ...info(nextId, [`:${server.port}`, server.processName, reachOf(server.addresses) === Reach.Network ? 'reachable from your network' : 'local only'].join(' · ')),
        tooltip: cannotStopHint(server, null) || undefined,
      }));
      const count = servers.length === 1 ? '1 port' : `${servers.length} ports`;
      const hint = cannotStopHint(first, null);
      return { id: nextId(MenuAction.Group), title: `${name} · ${count}`, tooltip: hint || undefined, items: [...lines, ...(lines.length > 0 ? [separator(nextId)] : []), ...ports] };
    });
}

/** The whole menu, rebuilt from a fresh scan every time it opens. */
export function buildMenu(state: MenuState): MenuItem[] {
  const nextId = idFactory();
  const primary = state.servers.filter(isPrimary);
  const others = state.servers.filter((server) => !isPrimary(server));
  const items: MenuItem[] = [];

  if (primary.length === 0) {
    items.push(
      info(nextId, 'Nothing you started is listening'),
      info(nextId, 'Start a dev server and it appears here'),
    );
  }
  for (const { section, servers } of groupServers(primary, false)) {
    if (items.length > 0) items.push(separator(nextId));
    items.push(info(nextId, section.title.toUpperCase()), ...servers.map((server) => serverItem(server, state, nextId)));
  }

  if (others.length > 0) {
    items.push(separator(nextId), {
      id: nextId(MenuAction.Header),
      title: `Other ports (${others.length})`,
      items: otherGroups(others, nextId),
    });
  }
  items.push(
    separator(nextId),
    { id: MenuAction.ToggleLogin, title: 'Start automatically when my Mac starts', checked: state.startAtLogin },
    { id: MenuAction.Quit, title: 'Quit Portlight' },
  );
  return items;
}

export function urlFor(server: Pick<Server, 'port'>): string {
  return `http://${LOCALHOST}:${server.port}`;
}
