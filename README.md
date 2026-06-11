# LanCache Dashboard

A lightweight, self-hosted dashboard for monitoring a [LanCache](https://lancache.net/) instance. It shows real-time downloads, how much WAN bandwidth your cache is saving, per-service and per-client breakdowns, and which games are sitting in your cache — with cover art.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![SQLite](https://img.shields.io/badge/SQLite-WAL-blue) ![License](https://img.shields.io/badge/license-MIT-green)

Built to stay light on resources and tiny on disk, even when your access logs grow into the hundreds of gigabytes. It pre-aggregates log data instead of storing raw lines, so the database stays small no matter how big the logs get.

---

## Screenshots

### Cache Savings
![Cache Savings](docs/screenshots/cache-savings.png)

### Stats Overview
![Stats Overview](docs/screenshots/stats-cards.png)

### Live Downloads
![Live Downloads](docs/screenshots/live-downloads.png)

### Bandwidth Trend
![Bandwidth Chart](docs/screenshots/bandwidth-chart.png)

### Services Breakdown
![Services](docs/screenshots/services.png)

### Recent Activity
![Recent Activity](docs/screenshots/recent-activity.png)

### Cached Games
![Cached Games](docs/screenshots/cached-games.png)

### Clients
![Clients](docs/screenshots/clients.png)

---

## Features

- **Cache savings at a glance** — A hero banner shows exactly how much bandwidth was served from cache vs fetched from the internet, so you can see what you're saving.
- **Live downloads** — A persistent server-side tailer tracks downloads across **all services** in real time, grouped into sessions per client and game. Steam downloads show the resolved game name and cover art; other services show by platform. Open the page mid-download and you immediately see what's active (it doesn't only start watching when you connect).
- **Cached games with cover art** — Steam depots are resolved to real game names and header images. See which games have passed through your cache, their size, and hit rate. *(Experimental — see note below.)*
- **Per-service breakdown** — Bandwidth, requests, cache savings, and hit rate for each platform (Steam, Epic, Battle.net, Riot, WSUS, etc.), as cards or a donut chart.
- **Top clients leaderboard** — Which machines pulled the most, how much they saved from cache, and their hit rate.
- **Daily bandwidth trend** — A 30-day stacked chart of cache vs internet traffic.
- **Automatic ingestion** — New log lines are parsed every 60 seconds. Handles log rotation automatically.
- **Tiny footprint** — Hundreds of GB of logs aggregate down to a SQLite DB measured in megabytes.

---

## Quick Start (Docker)

1. Create your compose file from the template:

   ```bash
   cp docker-compose.example.yml docker-compose.yml
   ```

2. Edit `docker-compose.yml` — point the volume at your LanCache log directory and set any options:

   ```yaml
   volumes:
     - /path/to/your/lancache/logs:/logs:ro   # your access.log lives here
     - ./data:/app/data                        # DB + depot mappings persist here
   ```

3. Prepare the data directory (the container runs as UID 1001):

   ```bash
   mkdir -p data && sudo chown -R 1001:1001 data
   ```

4. Start it:

   ```bash
   docker compose up -d --build
   ```

5. Open `http://your-server-ip:3000`

Your `docker-compose.yml` is gitignored, so any credentials you put in it stay local. On first launch the dashboard ingests your `access.log` and downloads the Steam depot mapping in the background (see [Game identification](#game-identification)).

---

## Quick Start (Bare Metal)

Requires Node.js 20+.

```bash
npm install

# Point at your access.log
export LOG_PATH=/path/to/lancache/logs/access.log
export DB_PATH=./data/lancache.db

npm run build
npm start
```

Open `http://localhost:3000`.

For development:

```bash
npm run dev
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_PATH` | `../logs/access.log` | Path to your LanCache `access.log` |
| `DB_PATH` | `../data/lancache.db` | Path for the SQLite database. The Steam depot mapping is stored alongside it in the same directory. |
| `EXCLUDE_IPS` | `127.0.0.1,::1,172.,localhost` | Comma-separated IPs/prefixes hidden from stats by default. Prefill traffic from the cache host (often the Docker bridge `172.18.0.1`) misses heavily and skews real client numbers. Entries ending in `.` or `:` are treated as prefixes. Toggle on/off live in the UI. |
| `CACHE_MAX_AGE_DAYS` | `60` | Your lancache cache retention window. Used to estimate whether a game is "likely still cached" (last seen within this many days). Match it to your lancache `CACHE_MAX_AGE`. |
| `PORT` | `3000` | Server port |

> **Prefill / localhost traffic** — LanCache prefill runs from the cache host itself and is *expected* to miss almost everything. Counting it tanks your apparent hit rate (e.g. 24% real → 5% with prefill). By default the dashboard hides these IPs from all stats and the live view, but keeps ingesting them, so you can flip the **Hiding/Showing prefill** toggle in the header at any time without re-processing logs.

> **Data directory** — The depot mapping file (~100MB) and the SQLite database both live in the directory that contains `DB_PATH`. Make sure that directory is on a persistent volume.

---

## Security

The dashboard is built for a trusted LAN, but it ships with two opt-in protections — worth enabling if anyone besides you can reach it.

| Variable | Effect |
|----------|--------|
| `ADMIN_API_KEY` | When set, the **Ingest Logs** and **Update Depots** actions require this key. Viewing all stats stays open. Enter the key once via the **Admin** button in the UI (stored in your browser). Recommended — it stops random viewers from triggering re-ingests or 100MB depot downloads. |
| `DASHBOARD_USER` + `DASHBOARD_PASSWORD` | When both are set, the **entire** dashboard (UI + API) is behind HTTP Basic Auth — nobody sees anything without the credentials. Use this for stricter setups. |

Other notes:
- Read endpoints (stats, clients, games, live) are intentionally open so the dashboard "just works" for viewers. Only mutating actions are gated by `ADMIN_API_KEY`.
- Mutating actions are also single-flight (a second trigger returns 409 while one is running), which blunts abuse.
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) are always applied.
- **Don't expose this directly to the internet.** Keep it on your LAN, or bind to localhost (`127.0.0.1:3000:3000` in compose) and put it behind a reverse proxy with TLS + auth if you need remote access.
- No SQL injection (parameterized queries), no path traversal (paths come from env), no command execution, and the one outbound fetch endpoint is locked to Steam's host.

---

## How It Works

1. **Parser** reads `access.log` incrementally, tracking the byte offset so it only processes new lines. It detects log rotation (file shrinking) and starts over when needed.
2. **Aggregator** rolls each line into hourly and daily summary tables keyed by service and client. It tracks bytes served from cache (HIT) separately from bytes fetched upstream (MISS), so cache savings are accurate.
3. **Auto-ingest** runs every 60 seconds in the background, processing up to 500k new lines per cycle.
4. **API routes** serve the pre-aggregated data.
5. **Frontend** (Next.js + Tailwind + Recharts) renders the dashboard and refreshes periodically. The live view streams new log lines over SSE.

Because only aggregates are stored, a multi-hundred-GB log history collapses into a database of tens of megabytes.

---

## Game identification

The access log only contains Steam **depot IDs** (e.g. `/depot/2347771/chunk/...`), not game names. Mapping a depot to its game accurately requires Steam's PICS data, which normally needs an authenticated Steam session.

Instead of logging in, this dashboard uses a **pre-built depot → app mapping** published by the [lancache-manager](https://github.com/regix1/lancache-manager) project. On first run it downloads [`pics_depot_mappings.json`](https://github.com/regix1/lancache-pics) (~100MB, ~244k mappings, refreshed daily) and caches it locally. Depot resolution is then an instant, accurate local lookup — game names and cover images included. For depots not yet in the snapshot (brand-new releases), it falls back to the public Steam store API.

**Battle.net** games are resolved using TACT product codes embedded in CDN hostnames (e.g. `cod-assets.cdn.blizzard.com` → Call of Duty). The product list is based on [tpill90/battlenet-lancache-prefill](https://github.com/tpill90/battlenet-lancache-prefill).

**Other services (Epic, Riot, etc.)** cannot currently be resolved to game names — their CDN URLs are opaque hashes with no known public mapping. They're shown at the service level only.

---

## Cached Games — what "cached" means (Experimental)

This section is marked **Experimental** because it is **inferred from access logs, not a live scan of the cache folder.** Logs can't tell you what's physically on disk right now — nginx evicts content silently (LRU + max-age) without logging anything the parser can see. So the dashboard uses two honest signals:

- **Likely cached** — the title was active within your cache retention window (`CACHE_MAX_AGE_DAYS`, default 60). It was downloaded or served recently, so it's *probably* still on disk. This is the green badge.
- **Was cached** — served from cache historically, but not recently. It may have been evicted.

A game downloaded once (all cache MISSes, which *populate* the cache) correctly shows as "likely cached" even though it never had a HIT — because downloading it put it on disk. Conversely, a game last seen months ago is shown as "was cached" since it has probably been pruned.

For disk-accurate "what's actually cached right now", a full cache-folder scanner would be needed (reading each cached file's header to recover the original URL). That's a heavier, opt-in feature and isn't part of this build.

---

## Manual Ingestion

The dashboard ingests automatically, but you can trigger a pass manually:

```bash
curl -X POST http://localhost:3000/api/ingest
```

Or click **Ingest Logs** in the dashboard header.

---

## Systemd Service (Optional)

```ini
[Unit]
Description=LanCache Dashboard
After=network.target

[Service]
Type=simple
User=lancache
WorkingDirectory=/opt/lancache-dashboard
Environment=LOG_PATH=/var/log/lancache/access.log
Environment=DB_PATH=/opt/lancache-dashboard/data/lancache.db
Environment=PORT=3000
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=unless-stopped

[Install]
WantedBy=multi-user.target
```

---

## Tech Stack

- [Next.js 16](https://nextjs.org/) (App Router) — UI and API in a single process
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — embedded database, no external service
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [Recharts](https://recharts.org/) — charts
- [lucide-react](https://lucide.dev/) — icons

---

## Credits & Acknowledgements

- **[LanCache.NET](https://lancache.net/)** — the caching system this dashboard monitors.
- **[regix1/lancache-manager](https://github.com/regix1/lancache-manager)** and **[regix1/lancache-pics](https://github.com/regix1/lancache-pics)** — for the pre-built Steam depot → app mapping that powers Steam game identification. The lancache-manager project is MIT licensed.
- **[tpill90/battlenet-lancache-prefill](https://github.com/tpill90/battlenet-lancache-prefill)** — for the Battle.net TACT product code reference used to resolve Blizzard/Activision game names from CDN hostnames.
- **[DeveLanCacheUI](https://github.com/devedse/DeveLanCacheUI_Backend)** — prior art and inspiration for log-based LanCache monitoring.
- **[uklans/cache-domains](https://github.com/uklans/cache-domains)** — the canonical list of cacheable CDN domains that LanCache routes, used as the service registry reference.
- **Steam Store Web API** — for resolving depots not yet in the PICS snapshot, and for header art.

Game names, cover images, and related metadata are property of their respective owners and are used here for identification purposes only.

---

## License

Released under the [MIT License](./LICENSE).
