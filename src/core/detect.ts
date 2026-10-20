import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GIT_DIR, JS_RUNTIME_NAMES, PACKAGE_JSON, PROJECT_CACHE_MS, PROJECT_SEARCH_DEPTH } from './constants.js';
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

/** findProject with a short per-folder cache: the tray rescans every few seconds. */
export function findProjectCached(cwd: string | null, now: number = Date.now()): Project | null {
  if (!cwd) return null;
  const cached = projectCache.get(cwd);
  if (cached && now - cached.at < PROJECT_CACHE_MS) return cached.project;
  const project = findProject(cwd);
  projectCache.set(cwd, { project, at: now });
  return project;
}

/**
 * The project a process was started in: the nearest package.json (its `name`, else its folder),
 * else the nearest git root, else the folder itself. Never the home folder or `/`.
 */
export function findProject(cwd: string | null, home: string = os.homedir()): Project | null {
  if (!cwd || cwd === home || cwd === path.parse(cwd).root) return null;

  let dir = cwd;
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
  return { name: path.basename(cwd), root: cwd, deps: new Set() };
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
