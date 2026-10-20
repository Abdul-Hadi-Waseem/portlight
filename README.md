# Portlight

**See every port your Mac is listening on, what started it, and stop it safely, from the menu bar.**

"Port 3000 is already in use." Portlight tells you *what* is using it (`storefront — Next.js`, not `node`), whether it's healthy, where it was started, and lets you stop it in one click without hunting for PIDs.

```
npm install -g portlight
portlight tray
```

## The menu bar

Click the icon and you get your servers, grouped and named:

```
DEV SERVERS
🟢  storefront — Next.js · 3000        ▸  Open localhost:3000
🟢  blog-api — Python · 8765               Copy URL
CONTAINERS                                 Copy PID 41207
🟢  shop — nginx · 8080                    ─────
⚪  shop — PostgreSQL · 5433               Next.js · node · 180 MB
SERVICES                                   up 2h 14m · local only
⚪  PostgreSQL · 5432                      ~/code/storefront
Other ports (10)                           ─────
Start at login                             Stop storefront…
Quit Portlight
```

- **Real names.** The framework (Next.js, Vite, Django, Rails, Laravel, FastAPI, NestJS, Go, …) and the project (from `package.json`, the git folder, or the folder name). Databases and tools are named too: PostgreSQL, Redis, MySQL, MongoDB, Jenkins, Grafana, Kubernetes clusters (kind, minikube, k3s), `kubectl port-forward` targets and more.
- **Health at a glance.** 🟢 answers HTTP, 🔴 not responding, ⚪ not a web server (a database, say).
- **Docker containers by name.** A container's port is held by Docker Desktop on a Mac; Portlight asks Docker which container published it, and stops *that container* with `docker stop`.
- **Everything else, explained.** Ports opened by VS Code extensions, AirDrop, AirPlay and friends are grouped under *Other ports* by app, with one plain sentence each on what it is and whether you need to care. Hover anything Portlight won't stop to see why.
- **Start at login** from the menu, or `portlight login on`.

## The command line

```
portlight                    your dev servers, containers and services
portlight ls --all           every listening port, with PID and CPU
portlight free 3000          is 3000 free? if not, offer to stop whatever holds it
portlight kill 3000          stop everything on port 3000
portlight kill --pid 41207   stop one process
portlight open 3000          open http://localhost:3000
portlight ls --json          machine-readable, for scripts
portlight tray               put Portlight in the menu bar (tray --stop removes it)
portlight login on|off       start the menu bar icon when you log in
```

## Stopping things safely

Killing the wrong process is worse than not killing one, so Portlight is careful:

- **Re-checks before acting.** Right before every signal it re-reads the process and compares its start time and command line, so a PID recycled by another program is never hit.
- **Polite first.** SIGTERM, wait up to 3 seconds, and only then SIGKILL, after checking identity again.
- **The right tool for the job.** Containers stop with `docker stop`. Homebrew services with `brew services stop` (killing the process alone would let `brew` restart it). System services such as the PostgreSQL installer's are stopped through `launchd`, after the standard macOS password dialog.
- **Never touches** macOS's own processes or Docker Desktop itself (stopping that would stop every container).
- **Confirms the port is free afterwards**, including ports shared by several worker processes (gunicorn, puma), and says so if it isn't.

## Privacy

Portlight runs entirely on your Mac: no account, no analytics, no network calls except to `localhost`. It reads the port table with the standard macOS tools (`netstat`, `lsof`, `ps`, `launchctl`) and asks the `docker` CLI about containers when Docker is running. Health checks are a single HTTP `HEAD /` to your own dev servers, only when you open the menu, at most every 30 seconds, and never to databases.

## Requirements

- macOS (Apple Silicon or Intel)
- Node.js 20 or newer

Windows support is planned.

## License

MIT © Abdul Hadi Waseem
