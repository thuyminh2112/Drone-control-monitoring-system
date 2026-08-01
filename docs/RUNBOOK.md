# Runbook — run everything locally (macOS)

Four terminals: Redis, SITL, backend, frontend.

## 1. Redis

```bash
brew install redis   # once
redis-server --port 6379
```

Verify: `redis-cli ping` → `PONG`.

## 2. ArduPilot SITL (ArduCopter)

```bash
cd /Users/nghia/ardupilot
Tools/autotest/sim_vehicle.py -v ArduCopter -L CMAC --console --out=udp:127.0.0.1:14560
```

Add `-w` on the very first run only, to wipe EEPROM to defaults. Leave this
running — it opens a MAVProxy console showing heartbeats, mode changes, and
arming messages, useful for cross-checking the dashboard.

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
