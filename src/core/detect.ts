import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GIT_DIR, JS_RUNTIME_NAMES, NODE_MODULES_DIR, PACKAGE_JSON, PROJECT_CACHE_MS, PROJECT_SEARCH_DEPTH } from './constants.js';
import { FRAMEWORK_RULES, type FrameworkRule } from './frameworks.js';

export interface Project {
  name: string;
  root: string;
  deps: Set<string>;
}

interface PackageJson {
  name?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(file: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

const projectCache = new Map<string, { project: Project | null; at: number }>();

/**
 * The project for a process, cached briefly (the tray rescans every few seconds): from its working
 * folder when known, otherwise from its command line.
 */
export function findProjectCached(cwd: string | null, commandLine = '', now: number = Date.now()): Project | null {
  const key = cwd ?? `cmd:${commandLine}`;
  if (!cwd && !commandLine) return null;
  const cached = projectCache.get(key);
  if (cached && now - cached.at < PROJECT_CACHE_MS) return cached.project;
  const project = cwd ? findProject(cwd) : projectFromCommand(commandLine);
  projectCache.set(key, { project, at: now });
  return project;
}

/** The nearest folder at or above `start` that is a project (package.json or .git), or null. */
function findMarkedProject(start: string, home: string): Project | null {
  let dir = start;
  for (let depth = 0; depth < PROJECT_SEARCH_DEPTH && dir !== home && dir !== path.dirname(dir); depth += 1) {
    const pkg = readPackageJson(path.join(dir, PACKAGE_JSON));
    if (pkg) {
      const deps = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
      const name = typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name : path.basename(dir);
      return { name, root: dir, deps };
    }
    if (existsSync(path.join(dir, GIT_DIR))) return { name: path.basename(dir), root: dir, deps: new Set() };
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * The project a process was started in: the nearest package.json (its `name`, else its folder),
 * else the nearest git root, else the folder itself. Never the home folder or `/`.
 */
export function findProject(cwd: string | null, home: string = os.homedir()): Project | null {
  if (!cwd || cwd === home || cwd === path.parse(cwd).root) return null;
  return findMarkedProject(cwd, home) ?? { name: path.basename(cwd), root: cwd, deps: new Set() };
}

/** Splits a command line into arguments, keeping "quoted parts" together (Windows quotes paths). */
export function splitCommandLine(commandLine: string): string[] {
  return [...commandLine.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? '');
}

/**
 * The project, read from the command line when the working folder is unknown (always on Windows):
 * `C:\code\shop\node_modules\.bin\vite` → shop (the folder above node_modules); a script path →
 * its project. Only real projects (package.json or .git) count, so npm's own files never become a
 * project called "npm".
 */
export function projectFromCommand(commandLine: string, home: string = os.homedir()): Project | null {
  const [, ...args] = splitCommandLine(commandLine);
  for (const arg of args) {
    if (!path.isAbsolute(arg)) continue;
    const parts = arg.split(/[\\/]/);
    const modules = parts.indexOf(NODE_MODULES_DIR);
    const start = modules > 0 ? parts.slice(0, modules).join(path.sep) : path.dirname(arg);
    const project = start ? findMarkedProject(start, home) : null;
    if (project) return project;
  }
  return null;
}

function matches(rule: FrameworkRule, commandLine: string, processName: string, deps: Set<string>): boolean {
  const jsRuntimes: readonly string[] = JS_RUNTIME_NAMES;
  return (
    (rule.command?.test(commandLine) ?? false) ||
    (rule.names?.includes(processName) ?? false) ||
    (jsRuntimes.includes(processName) && (rule.deps?.some((dep) => deps.has(dep)) ?? false))
  );
}

export function detectFramework(commandLine: string, processName: string, deps: Set<string> = new Set()): FrameworkRule | null {
  return FRAMEWORK_RULES.find((rule) => matches(rule, commandLine, processName, deps)) ?? null;
}
