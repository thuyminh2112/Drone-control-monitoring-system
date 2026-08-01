# Runbook — run everything locally (macOS)

Four terminals: Redis, SITL, backend, frontend.

## 1. Redis

```bash
brew install redis   # once
redis-server --port 6379
```

Verify: `redis-cli ping` → `PONG`.

## 2. ArduPilot SITL (ArduCopter)

Run this in your own Terminal (it opens real GUI windows — don't run it
through anything headless):

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
  you can visually watch the drone move during Takeoff/RTL.

If no window appears, `sim_vehicle.py` is being run without a display
(e.g. over SSH or inside a headless shell) — it needs an actual local
Terminal session on your Mac to open GUI windows.

## 3. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Verify: `curl http://localhost:8000/api/drone/state` returns JSON telemetry
once SITL has sent a few heartbeats.

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Manual verification checklist

- [ ] `redis-cli ping` → `PONG`
- [ ] MAVProxy console shows periodic heartbeat / GPS lock messages
- [ ] `redis-cli SUBSCRIBE drone:telemetry` (separate terminal) shows JSON
      messages streaming
- [ ] `redis-cli GET drone:latest_state` returns the latest snapshot
- [ ] Dashboard shows "Connected", live-updating battery/GPS/altitude
- [ ] Browser DevTools → Network → WS frames arriving ~1-2 Hz
- [ ] Click **Arm** → MAVProxy console prints "ARMING MOTORS"; dashboard
      Armed indicator flips
- [ ] Click **Takeoff** (with altitude) → vehicle climbs in MAVProxy
      output; dashboard altitude increases
- [ ] Click **RTL** → flight mode changes to RTL in both MAVProxy and
      dashboard, vehicle returns and lands
- [ ] Click **Disarm** → motors disarm, dashboard reflects it
- [ ] Kill SITL process → dashboard shows "Disconnected" within ~5s,
      backend keeps retrying, reconnects cleanly when SITL restarts
