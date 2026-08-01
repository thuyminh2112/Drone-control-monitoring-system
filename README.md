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
- Commands: Arm, Disarm, Takeoff, Return to Launch (RTL)
- **Search mode**: click a point on the in-app map to send the vehicle to
  survey it — see below.

## Search mode

Flow: **Arm → Takeoff → toggle "Search Mode" → click a point on the map →
"Start Search"**.

The vehicle flies to the clicked point in GUIDED mode (via
`MAV_CMD_DO_REPOSITION`, the same "fly to here" mechanism GCS software like
QGroundControl uses), then automatically switches to ArduCopter's native
**CIRCLE** mode once within 5m to orbit the point — simulating the vehicle
surveying that location during a search sortie. Arm/Disarm/Takeoff/RTL all
cancel an in-progress search.

## Quick start

See `docs/RUNBOOK.md`.
