#!/usr/bin/env bash
set -euo pipefail

ARDUPILOT_DIR="${ARDUPILOT_DIR:-/Users/nghia/ardupilot}"

cd "$ARDUPILOT_DIR"
exec Tools/autotest/sim_vehicle.py -v ArduCopter -L CMAC --console --out=udp:127.0.0.1:14560 "$@"
