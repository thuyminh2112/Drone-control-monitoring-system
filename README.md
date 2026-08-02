# SAR Mission Control — Drone Control & Monitoring System

[![GitHub repo](https://img.shields.io/badge/GitHub-thuyminh2112%2FDrone--control--monitoring--system-181717?logo=github)](https://github.com/thuyminh2112/Drone-control-monitoring-system)

A prototype Ground Control Station (GCS) for a single simulated drone,
framed as a Search & Rescue (SAR) sortie monitor. A simulated ArduCopter
(ArduPilot SITL) stands in for a drone searching a disaster-struck area for
survivors. An operator watches live telemetry and issues flight commands —
including a full multi-waypoint mission — from a web dashboard.

## Scenario

After a disaster (flood, earthquake, etc.) roads may be impassable and the
search area too large to cover on foot quickly. A SAR team launches a drone
to fly a search pattern over the affected area while an operator at a
laptop monitors the vehicle's health and position in real time, and can
command an emergency Return-to-Launch if battery runs low, connection
degrades, or the sortie needs to abort.

## Architecture

```
ArduCopter SITL --MAVLink/UDP--> mavlink_client.py (bg thread) --> redis_bridge.py --Redis pub/sub--> /ws/telemetry --> React dashboard
                                         ^
                                         | (command queue, blocking call from asyncio.to_thread)
                    routers/commands.py (POST /api/drone/arm|disarm|takeoff|land|rtl|search|mission/start|mission/cancel)
```

- **Backend** (FastAPI): a background thread owns the MAVLink connection to
  SITL end-to-end — it reads telemetry and sends commands (pymavlink
  connections aren't safe to share across threads). Telemetry is normalized
  and published to Redis (pub/sub channel + latest-state cache). A
  WebSocket endpoint fans that out to any number of connected browsers.
  REST endpoints enqueue commands to the background thread and return the
  real MAVLink `COMMAND_ACK` result.
- **Redis**: decouples MAVLink ingestion from WebSocket delivery, lets
  multiple browser tabs subscribe without each opening their own MAVLink
  connection, and caches the latest state so a newly-connected client isn't
  left blank.
- **Frontend**: React + Vite + TypeScript, live-updating dashboard
  connected via WebSocket, plus a Leaflet map for mission planning and
  live vehicle tracking.

See `docs/ARCHITECTURE.md` for the full design rationale and
`docs/RUNBOOK.md` for a manual verification checklist.

## Features

Dashboard:
- Connection status, battery level, GPS position, altitude, flight mode,
  armed/disarmed status, roll/pitch/yaw and vertical speed
- Commands: **Arm**, **Disarm**, **Takeoff** (flies straight to a default
  10 m), **Land** (descends straight down at the vehicle's current
  position), **Return to Launch** (RTL — holds current altitude on the way
  home, then descends once over the launch point)
- **Waypoint Mission** planning: click multiple points on the map to build
  an ordered route, set altitude, optionally add "Return to Home", then
  upload and fly it in AUTO mode — see below

### Return to Launch

By default ArduCopter's RTL first climbs to a minimum altitude (~15 m)
before flying home. The backend forces `RTL_ALT_M`/`RTL_ALT` to 0 on every
connect (confirmed via the `PARAM_VALUE` echo), which tells ArduCopter to
hold whatever altitude it's already at instead — RTL flies straight back to
the launch point at the current altitude, then descends and lands once
over it.

### Waypoint Mission

Flow: toggle **"Waypoint Mission"** on → click points on the map to add
ordered waypoints (each carries the current altitude input) → optionally
enable **"Return to Home"** → **Start Mission**.

Under the hood this uploads a real multi-waypoint route via the MAVLink
mission protocol (`MISSION_COUNT` → `MISSION_REQUEST_INT`/`MISSION_ITEM_INT`
→ `MISSION_ACK`) and switches the vehicle to `AUTO`, rather than the older
single-point "fly to and hold" GUIDED command. If the vehicle is still on
the ground, a `NAV_TAKEOFF` item is inserted automatically before your
first waypoint. With "Return to Home" enabled, a trailing
`MAV_CMD_NAV_RETURN_TO_LAUNCH` item makes the vehicle fly home and land on
its own after the last waypoint.

## Prerequisites

- **macOS** (the SITL/venv paths below assume macOS; adjust for other
  platforms)
- Python 3.10+ and Node.js 18+
- [Homebrew](https://brew.sh) (for Redis)
- [ArduPilot](https://ardupilot.org/dev/docs/building-setup-mac.html)
  cloned and built (`build/sitl/bin/arducopter`), with a **separate**
  Python venv containing `pexpect`, `MAVProxy`, and `pymavlink` for
  `sim_vehicle.py`'s tooling (the system/backend Python does not need
  these)

This repo assumes ArduPilot is at `/Users/nghia/ardupilot` and its SITL
venv at `/Users/nghia/ardupilot-venv` (see `scripts/start_sitl.sh`, which
also accepts `ARDUPILOT_DIR`/`ARDUPILOT_VENV` env var overrides) — adjust
if your machine differs.

## Setup & running

Four processes, in four terminals: Redis, SITL, backend, frontend. Use the
`scripts/start_*.sh` wrappers below, or the manual commands underneath each
one if you want more control (e.g. SITL's `--console --map` GUI windows).

### 1. Redis

```bash
brew install redis   # once
redis-server --port 6379
```

Or: `scripts/start_redis.sh`. Verify with `redis-cli ping` → `PONG`.

### 2. ArduPilot SITL (ArduCopter)

Run this in your own Terminal window — it opens real GUI windows, so don't
run it through anything headless (e.g. SSH):

```bash
source /Users/nghia/ardupilot-venv/bin/activate
cd /Users/nghia/ardupilot
Tools/autotest/sim_vehicle.py -v ArduCopter -L CMAC --console --map --out=udp:127.0.0.1:14560
```

Or: `scripts/start_sitl.sh`. Add `-w` on the very first run only, to wipe
EEPROM to defaults. MAVProxy must actually be running (don't pass
`--no-mavproxy`) — the `--out=udp:...` relay only works because MAVProxy
forwards the vehicle's primary link to that extra UDP output.

This opens two windows worth keeping visible while you operate the
dashboard:
- **MAVProxy console** — text log of heartbeats, mode changes, and arming
  messages, useful for cross-checking the dashboard.
- **Map window** — a live map with the vehicle icon and its GPS track.

### 3. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Or: `scripts/start_backend.sh` (creates the venv and copies `.env`
automatically on first run).

Verify: `curl http://localhost:8000/health` and
`curl http://localhost:8000/api/drone/state` return JSON once SITL has
sent a few heartbeats.

`.env` (see `backend/.env.example`) controls the MAVLink connection
string, Redis URL, CORS origin, heartbeat timeout, and command ACK
timeout — defaults match the SITL/Redis commands above, so no changes are
needed for local use.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Or: `scripts/start_frontend.sh`. Open **http://localhost:5173** — Vite
proxies `/api` and `/ws` to the backend on port 8000.

## Verification checklist

- [ ] `redis-cli ping` → `PONG`
- [ ] MAVProxy console shows periodic heartbeat / GPS lock messages
- [ ] `redis-cli SUBSCRIBE drone:telemetry` (separate terminal) streams JSON
- [ ] `redis-cli GET drone:latest_state` returns the latest snapshot
- [ ] Dashboard shows "Connected", live-updating battery/GPS/altitude
- [ ] Browser DevTools → Network → WS frames arriving ~1-2 Hz
- [ ] **Arm** → MAVProxy prints "ARMING MOTORS"; dashboard Armed flips
- [ ] **Takeoff** → vehicle climbs in MAVProxy output; dashboard altitude
      increases
- [ ] Plan a **Waypoint Mission**, **Start Mission** → vehicle switches to
      AUTO and flies the route on the map
- [ ] **RTL** → flight mode changes to RTL in both MAVProxy and dashboard,
      vehicle returns and lands
- [ ] **Disarm** → motors disarm, dashboard reflects it
- [ ] Kill SITL → dashboard shows "Disconnected" within ~5s, backend keeps
      retrying, reconnects cleanly when SITL restarts

See `docs/RUNBOOK.md` for the same checklist with more detail.

## Known ArduCopter/SITL behavior (not bugs)

- The vehicle **auto-disarms** on the ground after a period of no stick
  input, and again shortly after RTL/AUTO lands — this is ArduCopter's own
  safety logic (`DISARM_DELAY`).
- Arm can be rejected with `MAV_RESULT_FAILED` for a short cooldown right
  after landing — a real ArduCopter arming check, not a backend bug.

## Further reading

- `docs/ARCHITECTURE.md` — full data flow and design rationale (why Redis,
  why pymavlink, why a single background thread)
- `docs/RUNBOOK.md` — manual verification checklist with expected output
  in both MAVProxy and the dashboard
- `CLAUDE.md` — implementation notes and ArduCopter-specific gotchas for
  anyone modifying `mavlink_client.py`
