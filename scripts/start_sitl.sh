#!/usr/bin/env bash
set -euo pipefail

ARDUPILOT_DIR="${ARDUPILOT_DIR:-/Users/nghia/ardupilot}"
ARDUPILOT_VENV="${ARDUPILOT_VENV:-/Users/nghia/ardupilot-venv}"

# sim_vehicle.py's dependencies (pexpect, MAVProxy, pymavlink) live in this
# dedicated venv, not the system python3.
source "$ARDUPILOT_VENV/bin/activate"

cd "$ARDUPILOT_DIR"
# --console opens a MAVProxy text console (heartbeats, mode/arm messages).
# --map opens a live map window with the vehicle icon and GPS track.
# Both are real GUI windows - run this in your own Terminal, not headless.
exec Tools/autotest/sim_vehicle.py -v ArduCopter -L CMAC --console --map --out=udp:127.0.0.1:14560 "$@"
