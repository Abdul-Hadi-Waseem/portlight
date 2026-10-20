import os from 'node:os';
import {
  APP_BUNDLE_PATTERN,
  APP_PATH_MARKERS,
  CONTAINER_RUNTIME_NAMES,
  CONTAINER_RUNTIME_PATH_MARKERS,
  DEV_RUNTIME_NAMES,
  LOOPBACK_ADDRESSES,
  SYSTEM_PATH_PREFIXES,
} from './constants.js';
import { customName, loadConfig, type PortlightConfig } from './config.js';
import { detectFramework, findProjectCached } from './detect.js';
import { APP_EXPLANATION, EXPLANATIONS, FRIENDLY_NAMES, HOW_TO_STOP, SYSTEM_EXPLANATION } from './explanations.js';
import { safeText } from './format.js';
import { listContainers } from '../sources/docker.js';
import { detectImage } from './images.js';
import { Reach, ServerKind, type ContainerInfo, type Listener, type PlatformAdapter, type ProcessInfo, type Server } from './types.js';

function safeTextOrNull(text: string | null): string | null {
  return text === null ? null : safeText(text);
}

export function appNameOf(commandLine: string): string | null {
  const match = APP_BUNDLE_PATTERN.exec(commandLine);
  return match?.[1] ? safeText(match[1]) : null;
}

export function currentUser(): string {
  return os.userInfo().username;
}

export function isContainerRuntime(info: Pick<ProcessInfo, 'name' | 'commandLine'>): boolean {
  const names: readonly string[] = CONTAINER_RUNTIME_NAMES;
  return (info.name !== null && names.includes(info.name)) || CONTAINER_RUNTIME_PATH_MARKERS.some((marker) => info.commandLine.includes(marker));
}

export function classify(info: Pick<ProcessInfo, 'user' | 'name' | 'commandLine'>, me: string): ServerKind {
  if (info.user !== me) return ServerKind.System;
  if (SYSTEM_PATH_PREFIXES.some((prefix) => info.commandLine.startsWith(prefix))) return ServerKind.System;
  if (isContainerRuntime(info)) return ServerKind.ContainerRuntime;
  const devRuntimes: readonly string[] = DEV_RUNTIME_NAMES;
  if (info.name !== null && devRuntimes.includes(info.name)) return ServerKind.Dev;
  if (APP_PATH_MARKERS.some((marker) => info.commandLine.includes(marker))) return ServerKind.App;
  return ServerKind.Dev;
}

/** Joins listeners with process details: one Server per pid + port, sorted by port. */
export function buildServers(listeners: Listener[], processes: Map<number, ProcessInfo>, me: string): Server[] {
  const byKey = new Map<string, Server>();
  for (const listener of listeners) {
    const key = `${listener.pid}|${listener.port}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.addresses.includes(listener.address)) existing.addresses.push(listener.address);
      continue;
    }
    const info = processes.get(listener.pid);
    const processName = safeText(info?.name ?? listener.processName);
    const commandLine = info?.commandLine ?? '';
    const cwd = info?.cwd ?? null;
    const project = findProjectCached(cwd);
    const framework = detectFramework(commandLine, processName, project?.deps);
    const baseKind = info ? classify(info, me) : ServerKind.System;
    const kind = framework?.service ? ServerKind.Service : baseKind;
    byKey.set(key, {
      port: listener.port,
      addresses: [listener.address],
      pid: listener.pid,
      processName,
      user: info?.user ?? '',
      // Databases and caches are listed as services whoever runs them. Display only: stopping
      // re-classifies the live process and still refuses other users' and system processes.
      kind,
      cpuPercent: info?.cpuPercent ?? 0,
      memoryBytes: info?.memoryBytes ?? 0,
      startedAt: info?.startedAt ?? null,
      commandLine,
      cwd,
      framework: framework?.label ?? null,
      project: safeTextOrNull(framework?.project?.(commandLine) ?? project?.name ?? null),
      appName: appNameOf(commandLine),
      container: null,
      probe: kind === ServerKind.Dev || (kind === ServerKind.Service && framework?.http === true),
    });
  }
  return [...byKey.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/**
 * Ports held by the container runtime (Docker Desktop's backend, OrbStack…) are really published
 * by containers. Each container gets its own row, matched on port and address: two containers can
 * publish the same port number on different addresses. When the address doesn't settle which
 * container it is, the row stays the runtime, which is never stopped: better no button than the
 * wrong container.
 */
export function attachContainers(servers: Server[], containers: ContainerInfo[]): Server[] {
  return servers.flatMap((server) => {
    if (server.kind !== ServerKind.ContainerRuntime) return [server];
    const onPort = containers.filter((container) => container.bindings.some((binding) => binding.port === server.port));
    const byAddress = onPort.filter((container) =>
      container.bindings.some((binding) => binding.port === server.port && server.addresses.includes(binding.address)),
    );
    const matched = byAddress.length > 0 ? byAddress : onPort.length === 1 ? onPort : [];
    if (matched.length === 0) return [server];

    return matched.map((container) => {
      const image = detectImage(container.image);
      const addresses = container.bindings.filter((b) => b.port === server.port).map((b) => b.address);
      return {
        ...server,
        addresses: addresses.length > 0 ? addresses : server.addresses,
        kind: ServerKind.Container,
        container,
        framework: image.label,
        project: safeText(container.composeProject ?? container.name),
        probe: !image.service,
      };
    });
  });
}

export async function scan(platform: PlatformAdapter): Promise<Server[]> {
  const listeners = await platform.listListeners();
  const processes = await platform.getProcesses(listeners.map((listener) => listener.pid));
  const servers = buildServers(listeners, processes, currentUser());
  // Only ask Docker when a runtime holds a port: no daemon round-trip on every scan otherwise.
  const needsDocker = servers.some((server) => server.kind === ServerKind.ContainerRuntime);
  const named = needsDocker ? attachContainers(servers, await listContainers()) : servers;
  return applyCustomNames(named, loadConfig());
}

/** The user's names from their config win over anything Portlight detected. */
export function applyCustomNames(servers: Server[], config: PortlightConfig): Server[] {
  return servers.map((server) => ({ ...server, customName: customName(config, server.port, server.commandLine) }));
}

/** Local if every address is loopback; anything bound to `*`, 0.0.0.0 or a LAN IP is reachable from the network. */
export function reachOf(addresses: string[]): Reach {
  const loopback: readonly string[] = LOOPBACK_ADDRESSES;
  return addresses.every((address) => loopback.includes(address) || address.startsWith('127.')) ? Reach.Local : Reach.Network;
}

export interface NameParts {
  /** What the user calls it: the project, or the service (`PostgreSQL`). */
  name: string;
  /** What runs it (`Next.js`), when that adds anything. */
  detail: string | null;
}

/** `storefront` + `Next.js`; `PostgreSQL` alone; the process name when nothing better is known. */
export function nameParts(
  server: Pick<Server, 'framework' | 'project' | 'processName' | 'kind'> & { appName?: string | null; customName?: string | null },
): NameParts {
  if (server.customName) {
    const detail = server.framework ?? server.processName;
    return { name: server.customName, detail: detail !== server.customName ? detail : null };
  }
  if (server.kind === ServerKind.App || server.kind === ServerKind.System) {
    const name = FRIENDLY_NAMES[server.processName] ?? server.appName ?? server.framework ?? server.processName;
    return { name, detail: name !== server.processName ? server.processName : null };
  }
  if (server.kind === ServerKind.Service || !server.project) return { name: server.framework ?? server.processName, detail: null };
  return { name: server.project, detail: server.framework ?? server.processName };
}

/** `Next.js · storefront`, `PostgreSQL`, or the process name: for dialogs and notifications. */
export function displayName(
  server: Pick<Server, 'framework' | 'project' | 'processName' | 'kind'> & { appName?: string | null; customName?: string | null },
): string {
  const { name, detail } = nameParts(server);
  return detail ? `${detail} · ${name}` : name;
}

/** One plain-language sentence: what this is and whether the user needs to care. */
export function explain(server: Pick<Server, 'appName' | 'processName' | 'kind' | 'framework'>): string | null {
  const known = EXPLANATIONS[server.appName ?? ''] ?? EXPLANATIONS[server.processName] ?? EXPLANATIONS[server.framework ?? ''];
  if (known) return known;
  if (server.kind === ServerKind.App) return APP_EXPLANATION(server.appName ?? server.processName);
  if (server.kind === ServerKind.System) return SYSTEM_EXPLANATION;
  return null;
}

/**
 * Hover text for something the user can't (or shouldn't) stop from Portlight: what it is, why,
 * and how they would stop it themselves.
 */
export function cannotStopHint(server: Server, refusal: string | null): string {
  const what = explain(server);
  const how =
    server.kind === ServerKind.ContainerRuntime
      ? HOW_TO_STOP.containerRuntime
      : server.kind === ServerKind.App
        ? HOW_TO_STOP.app(server.appName ?? server.processName)
        : server.kind === ServerKind.System
          ? HOW_TO_STOP.system
          : server.user && server.user !== currentUser()
            ? HOW_TO_STOP.otherUser(server.user)
            : refusal
              ? `Portlight won't stop it: ${refusal}.`
              : null;
  return [what, how].filter(Boolean).join(' ');
}
