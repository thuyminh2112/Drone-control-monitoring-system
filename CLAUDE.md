# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A prototype Ground Control Station ("SAR Mission Control") for a single simulated
drone: FastAPI backend + Redis + WebSocket, ArduPilot SITL (ArduCopter) as the
vehicle, React/Vite/TS dashboard. Framed as a Search & Rescue sortie monitor —
see `README.md` for the scenario and `docs/ARCHITECTURE.md` for the full data
flow and design rationale (read that file before making structural changes;
it explains *why* Redis and pymavlink were chosen, not just what they do).

## Commands

### Backend (`backend/`)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

No test suite or linter is configured yet. Sanity-check changes with:
```bash
python -m py_compile app/*.py app/routers/*.py app/services/*.py   # syntax check
curl http://localhost:8000/health
curl http://localhost:8000/api/drone/state
```

### Frontend (`frontend/`)

```bash
npm install
npm run dev          # http://localhost:5173, proxies /api and /ws to :8000
npm run build         # tsc -b && vite build — use this to typecheck
```

There is no separate `npm run typecheck`/`lint` script — `npm run build` is
the typecheck (it runs `tsc -b` first and fails on type errors).

### Redis

```bash
brew install redis   # once
redis-server --port 6379
```

### ArduPilot SITL (the simulated vehicle)

SITL is already cloned and built at `/Users/nghia/ardupilot`
(binary: `build/sitl/bin/arducopter`). Its Python tooling
(`pexpect`, `MAVProxy`, `pymavlink`) lives in a **separate** venv at
`/Users/nghia/ardupilot-venv` — the system `python3` does NOT have `pexpect`,
so `sim_vehicle.py` must be run through that venv, not backend's `.venv`:

```bash
source /Users/nghia/ardupilot-venv/bin/activate
cd /Users/nghia/ardupilot
Tools/autotest/sim_vehicle.py -v ArduCopter -L CMAC --out=udp:127.0.0.1:14560
```

MAVProxy must actually be running (don't pass `--no-mavproxy`) — the
`--out=udp:...` relay only works because MAVProxy forwards the vehicle's
primary link to that extra UDP output. In a non-interactive/headless shell,
add `--mavproxy-args="--daemon"` so MAVProxy doesn't block on stdin. Add `-w`
on the very first run only, to wipe EEPROM to defaults.

`scripts/start_*.sh` wrap all four of the above; `docs/RUNBOOK.md` has the
full manual verification checklist (what to expect in the MAVProxy console
vs. the dashboard for each command).

## Architecture

Data flows one direction, through Redis, to any number of browser clients:

```
ArduCopter SITL --MAVLink/UDP--> mavlink_client.py (bg thread) --> redis_bridge.py --Redis pub/sub--> /ws/telemetry --> React dashboard
                                         ^
                                         | (command queue, blocking call from asyncio.to_thread)
                    routers/commands.py (POST /api/drone/arm|disarm|takeoff|land|rtl|search|mission/start|mission/cancel)
```

- **`backend/app/mavlink_client.py`** — the single source of truth for
  vehicle state. One background thread owns the MAVLink socket end-to-end
  (pymavlink connections are not safe to share across threads): it both
  reads incoming telemetry *and* sends commands. FastAPI command handlers
  don't touch MAVLink directly — they call `mavlink_manager.submit_command()`
  via `asyncio.to_thread`, which enqueues a request and blocks until the
  background thread processes it and returns a `CommandResult`.
  - ArduCopter flight-mode numbers are hardcoded in `ARDUCOPTER_MODES` rather
    than relying on `mavutil.mode_mapping()` timing — this backend only ever
    talks to ArduCopter, so don't reach for MAVSDK/mode-agnostic code here.
  - `armed` is updated from HEARTBEAT (1Hz) **and** optimistically set
    immediately after a successful arm/disarm ACK (see `_cmd_arm`/`_cmd_disarm`)
    — without the optimistic update, a command sent right after Arm (e.g.
    Takeoff) can see stale `armed=False` and get incorrectly rejected. Keep
    this pattern if you add more state-dependent commands.
  - Heartbeat timeout (`settings.heartbeat_timeout_seconds`, default 5s) is
    what flips `connected` to `false` — independent of socket-level errors.
  - **Waypoint Mission** (`_cmd_mission_start`/`_upload_mission`) uploads a
    real multi-waypoint route via the MAVLink mission protocol
    (MISSION_COUNT → answer each MISSION_REQUEST_INT with MISSION_ITEM_INT →
    MISSION_ACK) and switches to AUTO, instead of the old single-point
    GUIDED "fly to and hold" (`_cmd_search`, still present but no longer
    wired to any frontend UI). Mission item seq 0 is reserved by ArduPilot
    for the home position (`AP_MISSION_FIRST_REAL_COMMAND`) — real commands
    must start at seq 1, or AUTO's takeoff-command scan fails with
    "Missing Takeoff Cmd" even if a real NAV_TAKEOFF item is sitting at
    seq 0. `_mission_seq_offset` tracks how many synthetic items (home,
    and takeoff when grounded) were prepended, so `MISSION_CURRENT` can be
    translated back into a 0-indexed position in `mission_waypoints` for
    the frontend. An optional trailing `MAV_CMD_NAV_RETURN_TO_LAUNCH` item
    (`return_to_home`) makes the vehicle fly home and land on its own after
    the last waypoint — its `param4` must be `0`, not `NaN` (unlike
    NAV_WAYPOINT/NAV_TAKEOFF, where `NaN` means "keep current yaw"), or
    ArduCopter rejects the whole upload with `MAV_MISSION_INVALID_PARAM4`.
  - Three ArduCopter parameters are force-configured over PARAM_SET on
    every (re)connect, each confirmed via the PARAM_VALUE echo rather than
    assumed (PARAM_SET is fire-and-forget over UDP) — see
    `_ensure_rtl_alt_configured`/`_ensure_auto_options_configured`/
    `_ensure_wp_yaw_behavior_configured`:
    - `RTL_ALT_M`/`RTL_ALT` = 0 — RTL holds current altitude home instead
      of first climbing to a fixed ~15m (the parameter was renamed
      `RTL_ALT`→`RTL_ALT_M` in a metric-units migration; both are set for
      cross-version compatibility).
    - `AUTO_OPTIONS` bit 1 (`AllowTakeOffWithoutRaisingThrottle`) — without
      it, AUTO's takeoff item waits forever for RC throttle input that a
      MAVLink-only GCS never provides, and the vehicle just sits armed on
      the ground until `DISARM_DELAY` kicks in.
    - `WP_YAW_BEHAVIOR` = 1 (`LOOK_AT_NEXT_WP`) — the ArduCopter default
      (`LOOK_AT_NEXT_WP_EXCEPT_RTL` = 2) deliberately holds the last
      heading during any RTL leg, including a mission's trailing
      `RETURN_TO_LAUNCH` item, instead of turning to face the direction
      of travel like it does for ordinary waypoints.
  - `HOME_POSITION` is only broadcast once, shortly after the EKF origin is
    set — `_ensure_home_position` explicitly requests it (retrying, since
    the request is fire-and-forget) so the frontend's home marker doesn't
    depend on catching that one broadcast at exactly the right moment.

- **`backend/app/redis_bridge.py`** — every telemetry tick (~2Hz, driven by
  `services/telemetry_publisher.py`) is both cached (`SET drone:latest_state`)
  and broadcast (`PUBLISH drone:telemetry`). The cache exists so a browser
  connecting mid-mission gets state immediately instead of waiting for the
  next tick; the pub/sub exists so multiple browser tabs can subscribe
  without each opening their own MAVLink connection. This is deliberate
  even for a single vehicle — see `docs/ARCHITECTURE.md` for the reasoning
  if you're tempted to simplify it away.

- **`backend/app/routers/websocket.py`** (`/ws/telemetry`) — on connect,
  sends the cached snapshot, then just relays `redis.pubsub().listen()`
  messages verbatim. It does not talk to MAVLink at all.

- **`backend/app/routers/commands.py`** — REST endpoints do a *soft*
  pre-check against cached state (e.g. reject Takeoff with 409 if not
  armed) but always still forward accepted requests to MAVLink and return
  its real `COMMAND_ACK` result. Don't treat the soft check as sufficient
  validation on its own — ArduCopter's own rejections (e.g. arming-cooldown
  right after landing) are the real authority and must keep surfacing to
  the caller, not get swallowed.

- **Frontend** (`frontend/src/`) — `hooks/useTelemetry.ts` is the only
  WebSocket client; it exposes `{telemetry, status}` with exponential
  backoff reconnect. Dashboard components in `components/` are each a thin,
  mostly presentational wrapper around one telemetry field. `CommandPanel.tsx`
  is the one place that calls `api/client.ts`'s REST helpers. Land/RTL/in-air
  Disarm confirmations use the browser's own `window.confirm()`, not a
  custom dialog component (`ConfirmDialog.tsx` still exists and is used for
  in-air Disarm) — a custom `ConfirmDialog` overlay for Land/RTL mysteriously
  never rendered despite the click handlers firing correctly and no CSS
  overlay blocking the buttons (never root-caused; `window.confirm()`
  sidesteps it entirely and has been reliable since). Styling is hand-rolled
  CSS custom properties in `styles/tokens.css` (light/dark via
  `prefers-color-scheme`) plus utility classes in `styles/globals.css` — no
  CSS framework or component library.
  - **`MissionPlanCard.tsx`** — "Waypoint Mission" planning UI: toggling it
    on lets the operator click multiple map points (each carrying the
    current altitude input) into an ordered, removable list; "Return to
    Home" toggle is sent as `return_to_home` on `POST /mission/start`.
    "Grid Survey"/"Orbit & Loiter" are shown disabled ("Coming soon") — no
    backend support, and a clickable no-op would be worse than an honest
    disabled state.
  - **`MapPanel.tsx`** — draws, as separate Leaflet layers/refs so each can
    be redrawn independently: the vehicle chevron marker (red, rotates with
    heading); a draggable house-icon "planned home" marker shown only while
    `missionPlanningOn` (its position feeds the planned route line, but
    dragging it does **not** call `MAV_CMD_DO_SET_HOME` — it's planning-only
    today); a fixed, non-draggable home marker shown while
    `telemetry.mission_active`; the planned route (light-blue dashed,
    home → waypoints → home if "Return to Home" is on) and the
    active-mission route (black dashed, same shape, driven by
    `telemetry.mission_waypoints`/`mission_return_to_home`); and a red
    flight-trace polyline that accumulates the vehicle's actual GPS history,
    resetting on the disarmed→armed transition. Because the route layers
    get fully cleared and redrawn on every waypoint/mission change, they
    can re-insert themselves above the trace in the shared SVG stacking
    order — both route-drawing effects call `traceLineRef.current?.bringToFront()`
    after redrawing themselves so the trace stays visually on top
    regardless of which effect last touched the DOM.

## Known ArduCopter/SITL behavior (not bugs)

- The vehicle **auto-disarms** on the ground after a period of no stick
  input, and again shortly after RTL lands — this is ArduCopter's own
  safety logic (`DISARM_DELAY`), correctly reflected through the whole
  pipeline. Don't "fix" this by suppressing it client-side.
- Arm can be rejected with `MAV_RESULT_FAILED` for a short cooldown right
  after landing — again a real ArduCopter arming check, not a backend bug.
