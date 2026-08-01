# Architecture

## Components

1. **ArduPilot SITL (ArduCopter)** — simulates one drone. Launched via
   `sim_vehicle.py`, which also opens a MAVProxy console for manual
   inspection. An extra UDP output stream is dedicated to the backend so it
   doesn't compete with MAVProxy's own link.

2. **`mavlink_client.py`** — a single background thread owns the MAVLink
   UDP connection (`udpin:127.0.0.1:14560`). pymavlink sockets are not
   thread-safe for concurrent send/recv, so exactly one thread reads
   incoming messages and sends commands. Command requests from the async
   FastAPI side are put on a `queue.Queue`; results are returned via a
   matched `threading.Event` + result slot. The thread also tracks the last
   heartbeat timestamp — no heartbeat for 5s means `connected = False`, and
   the thread will keep trying to (re)connect. On each (re)connect it also
   sends `PARAM_SET RTL_ALT=0` once (`_ensure_rtl_alt_configured`) so
   ArduCopter's RTL holds the current altitude on the way home instead of
   first climbing to its default ~15m RTL altitude.

3. **`redis_bridge.py`** — every telemetry tick (~2 Hz) the normalized
   `TelemetryState` is:
   - `SET drone:latest_state <json>` — a snapshot cache so a browser that
     connects mid-mission immediately gets current state.
   - `PUBLISH drone:telemetry <json>` — pub/sub so every connected
     WebSocket client is updated in real time.

   This indirection matters even with one vehicle and one operator: it
   decouples telemetry *ingestion* (a blocking MAVLink thread) from
   *delivery* (async WebSocket handlers), lets any number of browser tabs
   subscribe independently, and the channel/key naming
   (`drone:{id}:...`) generalizes to multi-drone without redesign.

4. **FastAPI app** (`main.py`, `routers/`)
   - `GET  /api/drone/state` — REST snapshot (reads Redis cache).
   - `POST /api/drone/arm|disarm|takeoff|rtl` — sends a MAVLink command,
     waits for `COMMAND_ACK` (or mode-change confirmation for RTL) up to a
     timeout, returns `{success, message, mav_result}`.
   - `WS /ws/telemetry` — on connect, sends the cached latest state, then
     forwards every message published on `drone:telemetry`.

5. **Frontend** (React + Vite + TS) — `useTelemetry` hook holds the
   WebSocket connection (auto-reconnect with backoff) and feeds dashboard
   components. `CommandPanel` calls the REST endpoints and wraps
   destructive actions (RTL, disarm while armed) in a confirmation dialog.

## Data model

```json
{
  "connected": true,
  "armed": false,
  "flight_mode": "STABILIZE",
  "battery_percent": 87.0,
  "battery_voltage": 12.4,
  "lat": -35.363,
  "lon": 149.165,
  "alt_relative": 0.0,
  "alt_msl": 584.2,
  "groundspeed": 0.0,
  "heading": 45.0,
  "last_heartbeat": "2026-08-01T10:00:00Z",
  "timestamp": "2026-08-01T10:00:01Z"
}
```

## Why pymavlink (not MAVSDK or DroneKit)

- **DroneKit** is unmaintained and breaks on Python 3.10+ (it imports
  `collections.MutableMapping`, removed in favor of `collections.abc`).
- **MAVSDK-Python** requires a separate `mavsdk_server` gRPC proxy process
  — unnecessary complexity for a single-vehicle prototype.
- **pymavlink** talks MAVLink directly, is already installed and proven
  working in `/Users/nghia/ardupilot-venv` (version 2.4.49), and is what
  MAVProxy itself is built on.
