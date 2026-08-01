import logging
import math
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from pymavlink import mavutil

from .config import settings
from .telemetry import CommandResult, TelemetryState

logger = logging.getLogger("mavlink_client")

# ArduCopter custom_mode -> name. Hardcoded rather than relying on
# mavutil.mode_mapping() timing, since this prototype only ever talks to
# ArduCopter SITL.
ARDUCOPTER_MODES = {
    0: "STABILIZE", 1: "ACRO", 2: "ALT_HOLD", 3: "AUTO", 4: "GUIDED",
    5: "LOITER", 6: "RTL", 7: "CIRCLE", 9: "LAND", 11: "DRIFT", 13: "SPORT",
    14: "FLIP", 15: "AUTOTUNE", 16: "POSHOLD", 17: "BRAKE", 18: "THROW",
    19: "AVOID_ADSB", 20: "GUIDED_NOGPS", 21: "SMART_RTL", 22: "FLOWHOLD",
    23: "FOLLOW", 24: "ZIGZAG", 25: "SYSTEMID", 26: "AUTOROTATE",
    27: "AUTO_RTL",
}
ARDUCOPTER_MODES_BY_NAME = {name: num for num, name in ARDUCOPTER_MODES.items()}

# Autonomous/mission modes ArduCopter refuses to arm from on the ground
# (e.g. "Arm: RTL mode not armable"). After a completed RTL landing the
# vehicle stays in RTL rather than reverting to a manual mode, so Arm needs
# to steer it back to a safe standby mode first.
NOT_ARMABLE_ON_GROUND = {"RTL", "SMART_RTL", "AUTO_RTL", "AUTO", "LAND", "CIRCLE", "AUTOTUNE"}
STANDBY_MODE = "STABILIZE"

# "Search" flow: DO_REPOSITION flies to the chosen point in GUIDED mode;
# once within this radius the vehicle is switched into ArduCopter's native
# CIRCLE mode to orbit the point (radius/rate controlled by CIRCLE_RADIUS/
# CIRCLE_RATE params on the vehicle, left at SITL defaults here).
SEARCH_ARRIVAL_RADIUS_METERS = 5.0
SEARCH_ORBIT_MODE = "CIRCLE"

RECONNECT_DELAY_SECONDS = 3.0
POLL_TIMEOUT_SECONDS = 0.2


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * earth_radius_m * math.asin(math.sqrt(a))


class _CommandRequest:
    __slots__ = ("name", "kwargs", "result", "done")

    def __init__(self, name: str, kwargs: dict):
        self.name = name
        self.kwargs = kwargs
        self.result: Optional[CommandResult] = None
        self.done = threading.Event()


class MAVLinkManager:
    """Owns the single MAVLink connection to SITL on a dedicated thread.

    pymavlink connections are not safe to use concurrently from multiple
    threads, so all sending/receiving happens on one background thread.
    Telemetry reads (`get_state`) are safe from any thread via a lock;
    commands are submitted through a queue and block the caller (expected
    to be run off the asyncio event loop) until processed.
    """

    def __init__(self, connection_string: str):
        self.connection_string = connection_string
        self._master = None
        self._state = TelemetryState()
        self._lock = threading.Lock()
        self._command_queue: "queue.Queue[_CommandRequest]" = queue.Queue()
        self._stop_event = threading.Event()
        self._last_heartbeat_monotonic: Optional[float] = None
        self._last_statustext: Optional[str] = None
        self._thread = threading.Thread(target=self._run, daemon=True, name="mavlink-client")

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=2)

    def get_state(self) -> TelemetryState:
        with self._lock:
            return self._state.model_copy()

    def submit_command(self, name: str, **kwargs) -> CommandResult:
        """Blocking call — run via asyncio.to_thread from request handlers."""
        request = _CommandRequest(name, kwargs)
        self._command_queue.put(request)
        wait_timeout = settings.command_ack_timeout_seconds + 2
        if not request.done.wait(timeout=wait_timeout):
            return CommandResult(success=False, message="Command timed out waiting for MAVLink thread")
        return request.result or CommandResult(success=False, message="Unknown error processing command")

    # -- background thread -------------------------------------------------

    def _run(self) -> None:
        self._connect()
        while not self._stop_event.is_set():
            self._drain_commands()
            try:
                msg = self._master.recv_match(blocking=True, timeout=POLL_TIMEOUT_SECONDS)
                if msg is not None:
                    self._handle_message(msg)
            except (OSError, ConnectionResetError) as exc:
                logger.warning("MAVLink recv error, reconnecting: %s", exc)
                self._reconnect()
            self._check_heartbeat_timeout()
            self._check_search_arrival()

    def _connect(self) -> None:
        while not self._stop_event.is_set():
            try:
                logger.info("Connecting to MAVLink at %s", self.connection_string)
                self._master = mavutil.mavlink_connection(self.connection_string)
                return
            except Exception as exc:  # noqa: BLE001 - want to retry on any connect error
                logger.warning("MAVLink connect failed (%s), retrying in %.0fs", exc, RECONNECT_DELAY_SECONDS)
                self._stop_event.wait(RECONNECT_DELAY_SECONDS)

    def _reconnect(self) -> None:
        with self._lock:
            self._state.connected = False
        try:
            if self._master is not None:
                self._master.close()
        except Exception:  # noqa: BLE001
            pass
        self._stop_event.wait(RECONNECT_DELAY_SECONDS)
        self._connect()

    def _check_heartbeat_timeout(self) -> None:
        with self._lock:
            if self._last_heartbeat_monotonic is None:
                return
            if time.monotonic() - self._last_heartbeat_monotonic > settings.heartbeat_timeout_seconds:
                self._state.connected = False

    def _check_search_arrival(self) -> None:
        with self._lock:
            has_target = self._state.search_target_lat is not None and self._state.search_target_lon is not None
            en_route = has_target and self._state.flight_mode == "GUIDED"
            if not en_route or self._state.lat is None or self._state.lon is None:
                return
            target_lat, target_lon = self._state.search_target_lat, self._state.search_target_lon
            cur_lat, cur_lon = self._state.lat, self._state.lon
        distance = _haversine_meters(target_lat, target_lon, cur_lat, cur_lon)
        if distance <= SEARCH_ARRIVAL_RADIUS_METERS:
            if self._set_mode(SEARCH_ORBIT_MODE):
                logger.info("Arrived at search point (%.1fm), orbiting in %s", distance, SEARCH_ORBIT_MODE)
            else:
                logger.warning("Arrived at search point but failed to switch to %s", SEARCH_ORBIT_MODE)

    def _handle_message(self, msg) -> None:
        msg_type = msg.get_type()
        with self._lock:
            if msg_type == "HEARTBEAT":
                if msg.get_srcComponent() != mavutil.mavlink.MAV_COMP_ID_AUTOPILOT1:
                    return
                self._last_heartbeat_monotonic = time.monotonic()
                self._state.connected = True
                self._state.armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                self._state.flight_mode = ARDUCOPTER_MODES.get(msg.custom_mode, str(msg.custom_mode))
                self._state.last_heartbeat = datetime.now(timezone.utc)
            elif msg_type == "GLOBAL_POSITION_INT":
                self._state.lat = msg.lat / 1e7
                self._state.lon = msg.lon / 1e7
                self._state.alt_msl = msg.alt / 1000.0
                self._state.alt_relative = msg.relative_alt / 1000.0
                if msg.hdg != 65535:
                    self._state.heading = msg.hdg / 100.0
            elif msg_type == "VFR_HUD":
                self._state.groundspeed = msg.groundspeed
                if self._state.heading is None:
                    self._state.heading = msg.heading
            elif msg_type == "SYS_STATUS":
                if msg.battery_remaining >= 0:
                    self._state.battery_percent = float(msg.battery_remaining)
                if msg.voltage_battery != 65535:
                    self._state.battery_voltage = msg.voltage_battery / 1000.0
            elif msg_type == "STATUSTEXT":
                text = msg.text if isinstance(msg.text, str) else msg.text.decode(errors="replace")
                text = text.rstrip("\x00")
                self._last_statustext = text
                # severity <= 4 is ERROR/CRITICAL/ALERT/EMERGENCY in MAV_SEVERITY
                log = logger.warning if msg.severity <= 4 else logger.info
                log("SITL STATUSTEXT: %s", text)
                return
            else:
                return
            self._state.timestamp = datetime.now(timezone.utc)

    # -- commands ------------------------------------------------------------

    def _drain_commands(self) -> None:
        while True:
            try:
                request = self._command_queue.get_nowait()
            except queue.Empty:
                return
            try:
                request.result = self._dispatch_command(request.name, **request.kwargs)
            except Exception as exc:  # noqa: BLE001 - surface any failure to the caller
                logger.exception("Command %s failed", request.name)
                request.result = CommandResult(success=False, message=f"Command failed: {exc}")
            finally:
                request.done.set()

    def _dispatch_command(self, name: str, **kwargs) -> CommandResult:
        if name != "search":
            # Arm/Disarm/Takeoff/RTL all supersede any in-progress search —
            # clear it so the arrival check doesn't later hijack the mode
            # the new command just set.
            with self._lock:
                self._state.search_target_lat = None
                self._state.search_target_lon = None
        if name == "arm":
            return self._cmd_arm()
        if name == "disarm":
            return self._cmd_disarm()
        if name == "takeoff":
            return self._cmd_takeoff(kwargs.get("altitude", 10.0))
        if name == "rtl":
            return self._cmd_rtl()
        if name == "search":
            return self._cmd_search(kwargs["lat"], kwargs["lon"])
        raise ValueError(f"Unknown command: {name}")

    def _cmd_arm(self) -> CommandResult:
        if self._state.flight_mode in NOT_ARMABLE_ON_GROUND:
            if not self._set_mode(STANDBY_MODE):
                return CommandResult(
                    success=False,
                    message=f"Arm failed: could not leave {self._state.flight_mode} mode to reach an armable mode",
                )
        ack = self._send_command_long(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, param1=1)
        result = self._ack_to_result(ack, "Arm")
        if result.success:
            # HEARTBEAT (1Hz) may not have caught up yet; reflect the
            # accepted arm immediately so an instant follow-up command
            # (e.g. Takeoff) doesn't see stale armed=False.
            with self._lock:
                self._state.armed = True
        return result

    def _cmd_disarm(self) -> CommandResult:
        ack = self._send_command_long(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, param1=0)
        result = self._ack_to_result(ack, "Disarm")
        if result.success:
            with self._lock:
                self._state.armed = False
        return result

    def _cmd_takeoff(self, altitude: float) -> CommandResult:
        if not self._set_mode("GUIDED"):
            return CommandResult(success=False, message="Takeoff failed: could not switch to GUIDED mode")
        ack = self._send_command_long(mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, param7=altitude)
        return self._ack_to_result(ack, "Takeoff")

    def _cmd_rtl(self) -> CommandResult:
        if self._set_mode("RTL"):
            return CommandResult(success=True, message="RTL engaged", mav_result="MODE_CHANGED")
        return CommandResult(success=False, message="RTL failed: could not switch to RTL mode")

    def _cmd_search(self, lat: float, lon: float) -> CommandResult:
        target_alt = self._state.alt_relative or 10.0
        ack = self._send_command_int(
            mavutil.mavlink.MAV_CMD_DO_REPOSITION,
            frame=mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
            param1=-1,  # keep current groundspeed
            param2=1,  # MAV_DO_REPOSITION_FLAGS_CHANGE_MODE - switch to GUIDED
            param4=float("nan"),  # keep current yaw
            x=int(lat * 1e7),
            y=int(lon * 1e7),
            z=target_alt,
        )
        result = self._ack_to_result(ack, "Search")
        if result.success:
            with self._lock:
                self._state.search_target_lat = lat
                self._state.search_target_lon = lon
            result.message = f"Heading to search point ({lat:.5f}, {lon:.5f}) — will orbit on arrival"
        return result

    def _set_mode(self, mode_name: str) -> bool:
        mode_id = ARDUCOPTER_MODES_BY_NAME.get(mode_name)
        if mode_id is None or self._master is None:
            return False
        self._master.mav.set_mode_send(
            self._master.target_system,
            mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            mode_id,
        )
        return self._wait_until(lambda: self._state.flight_mode == mode_name, settings.command_ack_timeout_seconds)

    def _wait_until(self, predicate, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return True
            remaining = max(0.0, deadline - time.monotonic())
            msg = self._master.recv_match(blocking=True, timeout=min(POLL_TIMEOUT_SECONDS, remaining))
            if msg is not None:
                self._handle_message(msg)
        return predicate()

    def _send_command_long(self, command: int, param1=0, param2=0, param3=0, param4=0, param5=0, param6=0, param7=0):
        with self._lock:
            self._last_statustext = None
        self._master.mav.command_long_send(
            self._master.target_system,
            self._master.target_component,
            command,
            0,
            param1, param2, param3, param4, param5, param6, param7,
        )
        return self._wait_for_ack(command)

    def _send_command_int(self, command: int, frame: int = 0, param1=0, param2=0, param3=0, param4=0, x=0, y=0, z=0):
        with self._lock:
            self._last_statustext = None
        self._master.mav.command_int_send(
            self._master.target_system,
            self._master.target_component,
            frame,
            command,
            0,  # current
            0,  # autocontinue
            param1, param2, param3, param4,
            x, y, z,
        )
        return self._wait_for_ack(command)

    def _wait_for_ack(self, command_id: int, timeout: Optional[float] = None):
        timeout = timeout or settings.command_ack_timeout_seconds
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            remaining = max(0.0, deadline - time.monotonic())
            msg = self._master.recv_match(blocking=True, timeout=min(POLL_TIMEOUT_SECONDS, remaining))
            if msg is None:
                continue
            self._handle_message(msg)
            if msg.get_type() == "COMMAND_ACK" and msg.command == command_id:
                return msg
        return None

    def _ack_to_result(self, ack, label: str) -> CommandResult:
        if ack is None:
            return CommandResult(success=False, message=f"{label}: no acknowledgement received (timeout)")
        result_enum = mavutil.mavlink.enums.get("MAV_RESULT", {})
        result_entry = result_enum.get(ack.result)
        result_name = result_entry.name if result_entry else str(ack.result)
        success = ack.result == mavutil.mavlink.MAV_RESULT_ACCEPTED
        verb = "accepted" if success else "rejected"
        message = f"{label} {verb}: {result_name}"
        if not success and self._last_statustext:
            message = f"{message} — {self._last_statustext}"
        return CommandResult(success=success, message=message, mav_result=result_name)


mavlink_manager = MAVLinkManager(settings.mavlink_connection)
