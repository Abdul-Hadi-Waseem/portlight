import {
  DOCKER_BACKOFF_MS,
  DOCKER_BIN,
  DOCKER_BINDING_PATTERN,
  DOCKER_COMPOSE_PROJECT_LABEL,
  DOCKER_PS_TIMEOUT_MS,
  DOCKER_STOP_EXEC_TIMEOUT_MS,
  DOCKER_STOP_TIMEOUT_S,
  WILDCARD_ADDRESSES,
} from '../core/constants.js';
import { StopOutcome, type ContainerInfo, type PortBinding, type Server, type StopResult } from '../core/types.js';
import { run } from '../platform/exec.js';

interface DockerPsRow {
  ID?: string;
  Names?: string;
  Image?: string;
  Ports?: string;
  Labels?: string;
}

/** Docker writes 0.0.0.0 / :: for "all interfaces"; netstat writes `*`. Compare them as one. */
function normalizeAddress(address: string): string {
  const wildcard: readonly string[] = WILDCARD_ADDRESSES;
  return wildcard.includes(address) ? '*' : address;
}

/** TCP bindings a container publishes, ranges expanded: `0.0.0.0:8000-8001->…` → *:8000, *:8001. */
export function parseBindings(ports: string): PortBinding[] {
  const bindings = new Map<string, PortBinding>();
  for (const entry of ports.split(',').map((part) => part.trim())) {
    const match = DOCKER_BINDING_PATTERN.exec(entry);
    if (!match) continue;
    const address = normalizeAddress(match[1] ?? '');
    const from = Number(match[2]);
    const to = match[3] ? Number(match[3]) : from;
    for (let port = from; port <= to; port += 1) bindings.set(`${address}|${port}`, { address, port });
  }
  return [...bindings.values()];
}

function label(labels: string, key: string): string | null {
  const entry = labels.split(',').find((pair) => pair.startsWith(`${key}=`));
  return entry ? entry.slice(key.length + 1) : null;
}

/** Parses `docker ps --format '{{json .}}'`: one JSON object per line. */
export function parseDockerPs(output: string): ContainerInfo[] {
  const containers: ContainerInfo[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    let row: DockerPsRow;
    try {
      row = JSON.parse(line) as DockerPsRow;
    } catch {
      continue;
    }
    if (!row.ID) continue;
    containers.push({
      id: row.ID,
      name: row.Names ?? row.ID,
      image: row.Image ?? '',
      composeProject: label(row.Labels ?? '', DOCKER_COMPOSE_PROJECT_LABEL),
      bindings: parseBindings(row.Ports ?? ''),
    });
  }
  return containers;
}

let dockerUnresponsiveUntil = 0;

/**
 * Running containers, or [] when there is no docker CLI, the daemon isn't running, or it hangs.
 * After a hang Docker is skipped for a while, so the tray's frequent scans stay fast.
 */
export async function listContainers(now: number = Date.now()): Promise<ContainerInfo[]> {
  if (now < dockerUnresponsiveUntil) return [];
  try {
    const { stdout, code } = await run(DOCKER_BIN, ['ps', '--no-trunc', '--format', '{{json .}}'], { timeoutMs: DOCKER_PS_TIMEOUT_MS });
    return code === 0 ? parseDockerPs(stdout) : [];
  } catch {
    dockerUnresponsiveUntil = now + DOCKER_BACKOFF_MS;
    return [];
  }
}

/**
 * Stops the container behind a port with `docker stop`, never by signalling the runtime (that
 * would stop every container). Re-checks first that the same container still publishes the port.
 */
export async function stopContainer(server: Server): Promise<StopResult> {
  const { pid, port } = server;
  const result = (outcome: StopOutcome, reason?: string): StopResult => ({ pid, port, outcome, reason });
  const target = server.container;
  if (!target) return result(StopOutcome.Refused, 'not a container');

  const live = (await listContainers()).find((container) => container.id === target.id);
  if (!live) return result(StopOutcome.AlreadyGone);
  if (!live.bindings.some((binding) => binding.port === port)) {
    return result(StopOutcome.Refused, `container ${target.name} no longer publishes port ${port}`);
  }
  try {
    const { code, stderr } = await run(DOCKER_BIN, ['stop', '--time', String(DOCKER_STOP_TIMEOUT_S), target.id], {
      timeoutMs: DOCKER_STOP_EXEC_TIMEOUT_MS,
    });
    return code === 0 ? result(StopOutcome.Stopped) : result(StopOutcome.Failed, stderr.trim() || `docker stop exited ${code}`);
  } catch (error) {
    return result(
      StopOutcome.Failed,
      `docker stop did not finish in ${DOCKER_STOP_EXEC_TIMEOUT_MS / 1000} s (the container may still stop on its own): ${(error as Error).message}`,
    );
  }
}
