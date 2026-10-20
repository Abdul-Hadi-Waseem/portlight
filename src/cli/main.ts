#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ExitCode } from '../core/constants.js';
import { getPlatform } from '../platform/index.js';
import {
  freeCommand,
  killAllDevCommand,
  killCommand,
  listCommand,
  loginCommand,
  nextCommand,
  openCommand,
  trayCommand,
  waitCommand,
  watchCommand,
  welcomeOnce,
} from './commands.js';
import {
  Command,
  DIGITS_ONLY,
  HELP,
  LoginSetting,
  MAX_PORT,
  NEXT_DEFAULT_FROM,
  TargetKind,
  WAIT_DEFAULT_TIMEOUT_S,
} from './constants.js';

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

function usageError(message: string): ExitCode {
  console.error(`${message}\n\n${HELP}`);
  return ExitCode.Usage;
}

/** Plain decimal only: Number() would also accept `0x50` or `1e3`. */
function parseTarget(value: string | undefined, kind: TargetKind): number | null {
  if (value === undefined || !DIGITS_ONLY.test(value)) return null;
  const n = Number(value);
  return n > 0 && (kind === TargetKind.Pid || n <= MAX_PORT) ? n : null;
}

/** A whole number of seconds, at least 1. */
function parseSeconds(value: string): number | null {
  return DIGITS_ONLY.test(value) && Number(value) > 0 ? Number(value) : null;
}

async function main(argv: string[]): Promise<ExitCode> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      all: { type: 'boolean', short: 'a', default: false },
      json: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      pid: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      foreground: { type: 'boolean', default: false },
      dev: { type: 'boolean', default: false },
      free: { type: 'boolean', default: false },
      timeout: { type: 'string' },
      stop: { type: 'boolean', default: false },
    },
  });
  if (values.version) {
    console.log(version());
    return ExitCode.Ok;
  }
  const [command = Command.List, arg, ...extra] = positionals;
  if (values.help || command === Command.Help) {
    console.log(HELP);
    return ExitCode.Ok;
  }
  if (extra.length > 0) return usageError(`Unexpected argument "${extra[0]}".`);
  if (values.pid && command !== Command.Kill) return usageError('--pid only works with kill.');
  if ((values.foreground || values.stop) && command !== Command.Tray) return usageError('--foreground and --stop only work with tray.');
  if (values.dev && command !== Command.Kill) return usageError('--dev only works with kill.');
  if ((values.free || values.timeout !== undefined) && command !== Command.Wait) return usageError('--free and --timeout only work with wait.');

  const platform = getPlatform();
  if (command === Command.Watch) {
    if (arg !== undefined) return usageError(`Unexpected argument "${arg}".`);
    return watchCommand(platform);
  }
  if (command === Command.Next) {
    const from = arg === undefined ? NEXT_DEFAULT_FROM : parseTarget(arg, TargetKind.Port);
    return from === null ? usageError(`Expected a port number, got "${arg}".`) : nextCommand(platform, from);
  }
  if (command === Command.Wait) {
    const port = parseTarget(arg, TargetKind.Port);
    if (port === null) return usageError(`Expected a port number, got "${arg ?? ''}".`);
    const timeoutS = values.timeout === undefined ? WAIT_DEFAULT_TIMEOUT_S : parseSeconds(values.timeout);
    if (timeoutS === null) return usageError(`Expected --timeout in seconds, got "${values.timeout}".`);
    return waitCommand(port, { free: values.free, timeoutS });
  }
  if (command === Command.Kill && values.dev) {
    if (arg !== undefined || values.pid) return usageError('kill --dev takes no port or --pid.');
    return killAllDevCommand(platform, { yes: values.yes });
  }
  if (command === Command.Autostart || command === Command.Login) {
    const settings: readonly string[] = Object.values(LoginSetting);
    if (arg !== undefined && !settings.includes(arg)) return usageError(`Expected "on" or "off", got "${arg}".`);
    return loginCommand(platform, arg as LoginSetting | undefined);
  }
  if (command === Command.Tray) {
    if (arg !== undefined) return usageError(`Unexpected argument "${arg}".`);
    return trayCommand(platform, { foreground: values.foreground, stop: values.stop });
  }
  if (command === Command.List) {
    if (arg !== undefined) return usageError(`Unexpected argument "${arg}".`);
    if (!values.json) welcomeOnce();
    return listCommand(platform, { all: values.all, json: values.json });
  }

  const kind = values.pid ? TargetKind.Pid : TargetKind.Port;
  const target = parseTarget(arg, kind);
  switch (command) {
    case Command.Kill:
    case Command.Free:
    case Command.Open:
      if (target === null) return usageError(`Expected a ${kind} number, got "${arg ?? ''}".`);
      if (command === Command.Kill) return killCommand(platform, target, values.pid, { yes: values.yes });
      if (command === Command.Free) return freeCommand(platform, target, { yes: values.yes });
      return openCommand(platform, target);
    default:
      return usageError(`Unknown command "${command}".`);
  }
}

main(process.argv.slice(2)).then(
  // exitCode, not process.exit(): exiting straight away can cut off output still flushing to a pipe.
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const isUsageError = (error as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS') ?? false;
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = isUsageError ? ExitCode.Usage : ExitCode.Error;
  },
);
