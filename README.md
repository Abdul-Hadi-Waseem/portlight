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
Start automatically…                       Stop storefront…
Quit Portlight
```

- **Real names.** The framework (Next.js, Vite, Django, Rails, Laravel, FastAPI, NestJS, Go, …) and the project (from `package.json`, the git folder, or the folder name). Databases and tools are named too: PostgreSQL, Redis, MySQL, MongoDB, Jenkins, Grafana, Kubernetes clusters (kind, minikube, k3s), `kubectl port-forward` targets and more.
- **Health at a glance.** 🟢 answers HTTP, 🔴 not responding, ⚪ not a web server (a database, say).
- **Docker containers by name.** A container's port is held by Docker Desktop on a Mac; Portlight asks Docker which container published it, and stops *that container* with `docker stop`.
- **Everything else, explained.** Ports opened by VS Code extensions, AirDrop, AirPlay and friends are grouped under *Other ports* by app, with one plain sentence each on what it is and whether you need to care. Hover anything Portlight won't stop to see why.
- **Open the project** in your editor (Cursor, VS Code, Zed…) or in Finder, straight from the menu.
- **Stop all dev servers** in one click at the end of the day. Databases and containers are left alone.
- **Notifications** when a server starts or stops (switch them off in the menu).
- **Starts automatically** with your Mac: tick it in the menu, or run `portlight autostart on`.

## The command line

```
portlight                    your dev servers, containers and services
portlight ls --all           every listening port, with PID and CPU
portlight free 3000          is 3000 free? if not, offer to stop whatever holds it
portlight kill 3000          stop everything on port 3000
portlight kill --pid 41207   stop one process
portlight kill --dev         stop all your dev servers (not databases or containers)
portlight next               the next free port from 3000 (portlight next 8000)
portlight open 3000          open http://localhost:3000
portlight watch              live feed of servers starting and stopping
portlight tray               put Portlight in the menu bar (tray --stop removes it)
portlight autostart on|off   start the menu bar icon automatically when your Mac starts
```

### In scripts

```
portlight wait 5432 && npm test          # wait for the database to be up
portlight wait 3000 --free --timeout 30  # wait until the port is released
PORT=$(portlight next 3000) npm run dev  # start on the first free port
portlight ls --json                      # everything, machine-readable
```

## Your own names

Name the ports Portlight can't guess in `~/.config/portlight/config.json`:

```json
{
  "names": { "9000": "Payments API" },
  "rules": [{ "match": "gateway", "name": "Gateway" }],
  "editor": "Cursor",
  "notifications": true
}
```

`names` go by port; `rules` match any text in the command line. `editor` picks the app for *Open in…*.

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

- macOS (Apple Silicon or Intel), or Windows 10/11 (beta: `npm install -g portlight@beta`)
- Node.js 20 or newer

### On Windows (beta)

Everything above works, with three differences that come from Windows itself:

- **Stopping is a force-stop.** Windows has no polite "please quit" for terminal programs, so after the same identity checks Portlight ends the process directly.
- **Project names come from the command line.** Windows doesn't reveal another program's working folder, so `node C:\code\shop\node_modules\.bin\vite` is named *shop*; a server started some other way shows its program name.
- **Scans are slower** (PowerShell), so the menu refreshes every 10 seconds; opening it always shows a fresh list.

Stopping a Windows service (an installed PostgreSQL, say) asks for administrator approval (UAC).

## License

MIT © Abdul Hadi Waseem
