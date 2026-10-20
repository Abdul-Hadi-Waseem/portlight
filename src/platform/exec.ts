import { execFile } from 'node:child_process';
import { Signal } from '../core/constants.js';
import { EXEC_LOCALE, EXEC_MAX_BUFFER_BYTES, EXEC_TIMEOUT_MS } from './constants.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Runs a command without a shell. Resolves on a non-zero exit: lsof and ps exit 1 when some of
 * what was asked for no longer exists, and still print the rest.
 */
export interface RunOptions {
  timeoutMs?: number;
  /** Extra environment variables: how untrusted text reaches scripts without being spliced in. */
  env?: Record<string, string>;
}

export function run(file: string, args: string[], { timeoutMs = EXEC_TIMEOUT_MS, env = {} }: RunOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      // On timeout the child is killed and `error.code` is null, so this rejects: callers decide.
      {
        env: { ...process.env, LC_ALL: EXEC_LOCALE, ...env },
        maxBuffer: EXEC_MAX_BUFFER_BYTES,
        timeout: timeoutMs,
        killSignal: Signal.Kill,
        // Windows: no console window flashing up for every scan.
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({ stdout, stderr, code: typeof error?.code === 'number' ? error.code : 0 });
      },
    );
  });
}

/** Like `run`, but rejects when the command failed and printed nothing useful. */
export async function runChecked(file: string, args: string[], options: RunOptions = {}): Promise<ExecResult> {
  const result = await run(file, args, options);
  if (result.code !== 0 && result.stdout.trim() === '' && result.stderr.trim() !== '') {
    throw new Error(`${file} failed (exit ${result.code}): ${result.stderr.trim()}`);
  }
  return result;
}
