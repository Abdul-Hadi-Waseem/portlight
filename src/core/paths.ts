import os from 'node:os';
import path from 'node:path';

/** Read at call time, not import time, so tests (and `HOME=… portlight`) get their own folder. */
export function stateDir(): string {
  return path.join(os.homedir(), '.config', 'portlight');
}

export function configFile(): string {
  return path.join(stateDir(), 'config.json');
}
