# Runbook — run everything locally (macOS)

**Four separate Terminal windows, left running the whole session: Redis,
SITL, backend, frontend.** Closing any one of those windows kills that
process — the dashboard will show "Disconnected" (SITL down) or fail to
load entirely (backend/frontend down) until it's restarted. Start order
doesn't matter beyond "all four eventually up"; each waits/retries for the
others.

The commands below split into a **first-time setup** block (creates the
venv, installs deps) and an **every time after that** block (just activate
and run) — after the first run, use the shorter block.

## Quick deploy (everything already installed)

Once Redis, the backend venv, and frontend `node_modules` exist from a
prior first-time setup, this is the fastest way to bring the whole system
up: four commands, four Terminal windows. 
**Terminal A — Redis:**

```bash
cd scripts.start_redis.sh
```

**Terminal B — Backend:**

```bash
cd scripts/start_backend.sh
```

**Terminal C — Frontend:**

```bash
cd scripts/start_frontend.sh
```

Open the URL it prints (should be http://localhost:5173).

**Terminal D — ArduPilot SITL** (needs a real GUI Terminal — not
SSH/headless):

```bash
ARDUPILOT_DIR=/Users/YOUR_USER_NAME/ardupilot \
ARDUPILOT_VENV=/Users/YOUR_USER_NAMEn/ardupilot-venv \
cd scripts/start_sitl.sh -w

```

Leave all three (plus Redis) running for the whole session — closing any
one of these windows kills that process and the dashboard loses whatever
that piece provided (see the warning above). Once SITL's MAVProxy console
shows heartbeats, the dashboard should flip to "Connected" within a few
seconds. If any step fails (e.g. `.venv` or `node_modules` missing), fall
back to the detailed first-time setup in the sections below.

## 1. Redis

```bash
brew install redis   # once
redis-server --port 6379
```

Verify: `redis-cli ping` → `PONG`.

## 2. ArduPilot SITL (ArduCopter)

Run this in your own Terminal (it opens real GUI windows — don't run it
through anything headless, e.g. SSH):

```bash
source /Users/nghia/ardupilot-venv/bin/activate   # sim_vehicle.py's deps (pexpect, MAVProxy, pymavlink) live here
cd /Users/nghia/ardupilot
Tools/autotest/sim_vehicle.py -v ArduCopter -L CMAC --console --map --out=udp:127.0.0.1:14560
```

(equivalently: `scripts/start_sitl.sh`)

Add `-w` on the very first run only, to wipe EEPROM to defaults. Leave this
running — it opens two windows you can watch live:

- **MAVProxy console** — text log of heartbeats, mode changes, and arming
  messages, useful for cross-checking the dashboard.
- **Map window** — a live map with the vehicle icon and its GPS track, so
  you can visually watch the drone move during Takeoff/RTL/missions.

If no window appears, `sim_vehicle.py` is being run without a display
(e.g. over SSH or inside a headless shell) — it needs an actual local
Terminal session on your Mac to open GUI windows.

## 3. Backend

First time only (creates the venv, installs deps, creates `.env`):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Every time after that, in a fresh Terminal window:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

(equivalently: `scripts/start_backend.sh`, which auto-detects whether the
venv/`.env` already exist and only does first-time setup if needed.)

Verify: `curl http://localhost:8000/health` → `{"status":"ok"}`, and
`curl http://localhost:8000/api/drone/state` returns JSON telemetry once
SITL has sent a few heartbeats. `curl: (7) Failed to connect` means this
step isn't actually running — check this Terminal window is still open.

## 4. Frontend

First time only (installs deps):

```bash
cd frontend
npm install
npm run dev
```

Every time after that, in a fresh Terminal window:

```bash
cd frontend
npm run dev
```

(equivalently: `scripts/start_frontend.sh`.)

Open http://localhost:5173 — if that port's busy (an old dev server still
running from a previous session), Vite prints the fallback port it picked
instead; use that one, or kill the stale process holding 5173.

## Manual verification checklist

- [ ] `redis-cli ping` → `PONG`
- [ ] `curl http://localhost:8000/health` → `{"status":"ok"}`
- [ ] MAVProxy console shows periodic heartbeat / GPS lock messages
- [ ] `redis-cli SUBSCRIBE drone:telemetry` (separate terminal) shows JSON
      messages streaming
- [ ] `redis-cli GET drone:latest_state` returns the latest snapshot
- [ ] Dashboard shows "Connected", live-updating battery/GPS/altitude
- [ ] Browser DevTools → Network → WS frames arriving ~1-2 Hz
- [ ] Click **Arm** → MAVProxy console prints "ARMING MOTORS"; dashboard
      Armed indicator flips
- [ ] Click **Takeoff** → vehicle climbs straight to the default 10m in
      MAVProxy output; dashboard altitude increases
- [ ] Toggle **Waypoint Mission**, click a few map points, **Start
      Mission** → flight mode changes to AUTO, vehicle flies the plotted
      route in both MAVProxy/map window and dashboard
- [ ] Click **RTL** → flight mode changes to RTL in both MAVProxy and
      dashboard, vehicle returns and lands
- [ ] Click **Disarm** → motors disarm, dashboard reflects it
- [ ] Kill SITL process → dashboard shows "Disconnected" within ~5s,
      backend keeps retrying, reconnects cleanly when SITL restarts
