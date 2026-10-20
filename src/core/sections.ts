import { ServerKind, type Server } from './types.js';

export interface Section {
  kind: ServerKind;
  title: string;
  /** Shown without --all / outside the "Other" submenu. */
  primary: boolean;
}

export const SECTIONS: readonly Section[] = [
  { kind: ServerKind.Dev, title: 'Dev servers', primary: true },
  { kind: ServerKind.Container, title: 'Containers', primary: true },
  { kind: ServerKind.Service, title: 'Services', primary: true },
  { kind: ServerKind.App, title: 'Apps', primary: false },
  { kind: ServerKind.ContainerRuntime, title: 'Container runtime', primary: false },
  { kind: ServerKind.System, title: 'System', primary: false },
];

export function isPrimary(server: Server): boolean {
  return SECTIONS.find((section) => section.kind === server.kind)?.primary ?? false;
}

/** Servers grouped in SECTIONS order; empty sections are left out. */
export function groupServers(servers: Server[], includeSecondary: boolean): Array<{ section: Section; servers: Server[] }> {
  return SECTIONS.filter((section) => includeSecondary || section.primary)
    .map((section) => ({ section, servers: servers.filter((server) => server.kind === section.kind) }))
    .filter((group) => group.servers.length > 0);
}
