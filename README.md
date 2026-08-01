# SAR Mission Control — Drone Control & Monitoring System

[![GitHub repo](https://img.shields.io/badge/GitHub-thuyminh2112%2FDrone--control--monitoring--system-181717?logo=github)](https://github.com/thuyminh2112/Drone-control-monitoring-system)

A small prototype ground control station (GCS) for a Search & Rescue (SAR)
drone mission. A single simulated ArduCopter (ArduPilot SITL) stands in for
a drone searching a disaster-struck area for survivors. An operator watches
live telemetry and issues basic flight commands from a web dashboard.

## Scenario

After a disaster (flood, earthquake, etc.) roads may be impassable and the
search area too large to cover on foot quickly. A SAR team launches a drone
to fly a search pattern over the affected area while an operator at a laptop
monitors the vehicle's health and position in real time, and can command an
emergency Return-to-Launch if battery runs low, connection degrades, or the
sortie needs to abort.

## Architecture

```
ArduPilot SITL (ArduCopter) --MAVLink/UDP--> FastAPI backend --Redis pub/sub--> WebSocket --> React dashboard
                                                    |
                                            REST command endpoints (Arm/Disarm/Takeoff/RTL)
```

- **Backend**: FastAPI. A background thread owns the MAVLink connection to
  SITL, normalizes telemetry, and publishes it to Redis (pub/sub channel +
  latest-state cache). A WebSocket endpoint fans that out to any number of
  connected browsers. REST endpoints send MAVLink commands and wait for
  acknowledgement.
- **Redis**: decouples MAVLink ingestion from WebSocket delivery, lets
  multiple clients subscribe without each opening a MAVLink connection, and
  caches the latest state so a newly-connected client isn't left blank.
- **Frontend**: React + Vite + TypeScript, minimal Claude.ai-inspired
  design, live-updating dashboard connected via WebSocket.

See `docs/ARCHITECTURE.md` for details and `docs/RUNBOOK.md` for exact
commands to run everything locally.

## Dashboard

- Connection status
- Battery level
- Latitude / longitude
- Altitude
- Flight mode
- Armed / disarmed status
- Commands: Arm, Disarm, Takeoff, Land (descends straight down at the
  vehicle's current position — unlike RTL, it does not fly back to the
  launch point first), Return to Launch (RTL — holds current altitude on
  the way home, then descends once over the launch point; see below)
- **Search mode**: click a point on the in-app map to send the vehicle to
  survey it — see below.

## Return to Launch

By default ArduCopter's RTL first climbs to a minimum altitude (~15m)
before flying home, in case there are obstacles between the vehicle and
home. The backend sets that altitude to 0 on connect (via `PARAM_SET`),
which tells ArduCopter to hold whatever altitude it's already at instead —
RTL flies straight back to the launch point at the current altitude, then
descends and lands once over it, confirmed via a real MAVLink test: the
vehicle held 15.00m while distance-to-home dropped from 121m to 0m, only
descending after arriving.

The parameter is set under both names — `RTL_ALT_M` (meters) and `RTL_ALT`
(centimeters) — since recent ArduCopter builds renamed it as part of an
ongoing metric-units migration and older builds may still use the original
name; whichever one the connected firmware actually has gets confirmed via
its `PARAM_VALUE` echo (`PARAM_SET` is fire-and-forget over UDP, so the
confirmation matters — the backend retries every 2s until it arrives). To
restore the climb-first default for a specific test, run
`param set RTL_ALT_M 15` in the MAVProxy console — it resets to 0 the next
time the backend connects.

## Search mode

Flow: **Arm → toggle "Search Mode" → click a point on the map → set the
search altitude → "Start Search"**. No separate Takeoff step needed — if
the vehicle is still on the ground, Start Search takes off to the search
altitude itself before flying to the point.

If grounded, the vehicle climbs straight up to the search altitude first
(`MAV_CMD_NAV_TAKEOFF`) — the backend waits until it's essentially at that
altitude before sending any horizontal movement, so it goes straight up
then straight across rather than climbing and translating at the same
time. It then flies to the clicked point in GUIDED mode (via
`MAV_CMD_DO_REPOSITION`, the same "fly to here" mechanism GCS software like
QGroundControl uses) and holds position there — simulating the vehicle
surveying that location during a search sortie. If already airborne, it
just repositions to the new point/altitude directly (climbing/descending
and moving horizontally together). Arm/Disarm/Takeoff/Land/RTL all cancel
an in-progress search, and so does toggling "Search Mode" off while a
search is en route or already holding at the point — the vehicle stops
where it is and holds position (GUIDED mode holds the last commanded point
once no new setpoint follows).

## Quick start

See `docs/RUNBOOK.md`.
