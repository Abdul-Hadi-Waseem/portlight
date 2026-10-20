/**
 * How a listening process is named. Rules are tried in order; the first match wins.
 * - `command`: tested against the full command line. Patterns match a binary name as a whole
 *   path segment, so a folder called `vite-app` is not mistaken for Vite.
 * - `names`: exact executable names (services and runtimes).
 * - `deps`: package.json dependencies of the project, used when the command says only `node`.
 */
export interface FrameworkRule {
  label: string;
  command?: RegExp;
  names?: readonly string[];
  deps?: readonly string[];
  /** Databases, caches and other long-running services rather than dev servers. */
  service?: boolean;
  /** A service that answers HTTP (nginx, Ollama). Other services never get an HTTP health check. */
  http?: boolean;
  /** Names what the process serves when the folder doesn't (`kubectl port-forward svc/api` → `svc/api`). */
  project?: (commandLine: string) => string | null;
}

/** The resource after `port-forward`, skipping flags: `kubectl -n dev port-forward svc/api 8080:80` → `svc/api`. */
function portForwardTarget(commandLine: string): string | null {
  const args = commandLine.split(/\s+/);
  const start = args.indexOf('port-forward');
  return start === -1 ? null : (args.slice(start + 1).find((arg) => !arg.startsWith('-') && !/^\d/.test(arg)) ?? null);
}

/** `name` as a whole path segment or word: `/.bin/vite --port`, `vite`, `vite.js`; not `vite-app/`. */
function binary(name: string): RegExp {
  return new RegExp(`(?:^|[\\s/])${name}(?:\\.[cm]?js)?(?:\\s|$)`);
}

export const FRAMEWORK_RULES: readonly FrameworkRule[] = [
  // Command line: most specific.
  { label: 'Next.js', command: /^next-server\b|\/next\/dist\/|(?:^|[\s/])next (?:dev|start)\b/ },
  { label: 'Nuxt', command: /\/nuxt\/|(?:^|[\s/])nuxi? dev\b/ },
  { label: 'Astro', command: binary('astro') },
  { label: 'Remix', command: binary('remix') },
  { label: 'SvelteKit', command: /\/@sveltejs\/kit\// },
  { label: 'Storybook', command: binary('storybook') },
  { label: 'Angular', command: /(?:^|[\s/])ng serve\b|\/@angular\/cli\// },
  { label: 'Expo', command: binary('expo') },
  { label: 'Metro', command: /\/metro\/|react-native start/ },
  { label: 'Vite', command: binary('vite') },
  { label: 'webpack', command: /webpack-dev-server|(?:^|[\s/])webpack serve\b/ },
  { label: 'NestJS', command: /(?:^|[\s/])nest start\b/ },
  { label: 'Django', command: /manage\.py runserver/ },
  { label: 'Flask', command: /(?:^|[\s/])flask run\b/ },
  { label: 'FastAPI', command: binary('uvicorn') },
  { label: 'Gunicorn', command: binary('gunicorn') },
  { label: 'Rails', command: /(?:^|[\s/])rails (?:s|server)\b|(?:^|[\s/])puma\b/ },
  { label: 'Laravel', command: /artisan serve/ },
  { label: 'PHP', command: /(?:^|[\s/])php\S*\s.*-S\s/ },
  { label: 'Phoenix', command: /phx\.server/ },
  { label: 'Go', command: /\/go-build\d+\// },
  { label: 'Jenkins', command: /jenkins\.war/, service: true, http: true },
  { label: 'kubectl', command: /(?:^|[\s/])kubectl\s.*\bport-forward\b/, project: portForwardTarget },
  { label: 'Elasticsearch', command: /org\.elasticsearch\.(?:bootstrap|server)\./, service: true, http: true },
  { label: 'Kafka', command: /(?:^|\s)kafka\.Kafka(?:\s|$)/, service: true },
  // RabbitMQ runs on the Erlang VM with `-s rabbit` / `-sname rabbit@host` among its arguments.
  { label: 'RabbitMQ', command: /\s-s rabbit(?:\s|$)|\s-sname rabbit@/, service: true },

  // package.json dependencies: only consulted for node/bun processes.
  { label: 'Next.js', deps: ['next'] },
  { label: 'Nuxt', deps: ['nuxt'] },
  { label: 'Astro', deps: ['astro'] },
  { label: 'Remix', deps: ['@remix-run/node', '@remix-run/dev'] },
  { label: 'NestJS', deps: ['@nestjs/core'] },
  { label: 'Fastify', deps: ['fastify'] },
  { label: 'Hono', deps: ['hono'] },
  { label: 'Koa', deps: ['koa'] },
  { label: 'Express', deps: ['express'] },
  { label: 'Vite', deps: ['vite'] },

  // Bare executable names: least specific, last.
  { label: 'PostgreSQL', names: ['postgres', 'postmaster'], service: true },
  { label: 'MySQL', names: ['mysqld', 'mariadbd'], service: true },
  { label: 'MongoDB', names: ['mongod'], service: true },
  { label: 'Redis', names: ['redis-server'], service: true },
  { label: 'Memcached', names: ['memcached'], service: true },
  { label: 'nginx', names: ['nginx'], service: true, http: true },
  { label: 'Apache', names: ['httpd'], service: true, http: true },
  { label: 'Caddy', names: ['caddy'], service: true, http: true },
  { label: 'Ollama', names: ['ollama'], service: true, http: true },
  { label: 'Grafana', names: ['grafana', 'grafana-server'], service: true, http: true },
  { label: 'Prometheus', names: ['prometheus'], service: true, http: true },
  { label: 'Vault', names: ['vault'], service: true, http: true },
  { label: 'Consul', names: ['consul'], service: true, http: true },
  { label: 'ngrok', names: ['ngrok'], service: true, http: true },
  { label: 'cloudflared', names: ['cloudflared'], service: true },
  { label: 'Docker', names: ['com.docker.backend', 'com.docker.vpnkit', 'vpnkit-bridge'] },
  { label: 'OrbStack', names: ['OrbStack', 'OrbStack Helper'] },
  { label: 'Bun', names: ['bun'] },
  { label: 'Deno', names: ['deno'] },
  { label: 'Java', names: ['java'] },
];
