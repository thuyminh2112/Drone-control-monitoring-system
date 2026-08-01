import logging
import math
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from pymavlink import mavutil

from .config import settings
from .telemetry import CommandResult, MissionWaypoint, TelemetryState

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

# "Search" flow: DO_REPOSITION flies to the chosen point in GUIDED mode and
# holds there once arrived (GUIDED naturally holds the last commanded point
# when no new setpoint follows). SEARCH_ARRIVAL_RADIUS_METERS is only used
# to flip `search_arrived` for the frontend's status text.
SEARCH_ARRIVAL_RADIUS_METERS = 5.0

RECONNECT_DELAY_SECONDS = 3.0
POLL_TIMEOUT_SECONDS = 0.2
RTL_ALT_RETRY_INTERVAL_SECONDS = 2.0
MISSION_UPLOAD_TIMEOUT_SECONDS = 20.0

EARTH_RADIUS_METERS = 6371000.0


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(a))


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
        self._rtl_alt_configured: bool = False
        self._rtl_alt_last_attempt_monotonic: float = 0.0
        self._home_position_last_attempt_monotonic: float = 0.0
        # AUTO_OPTIONS bit 1 (AllowTakeOffWithoutRaisingThrottle) - without
        # it, ArduCopter's AUTO-mode takeoff item waits indefinitely for a
        # pilot to raise the throttle stick before actually climbing, which
        # never happens on a MAVLink-only GCS with no RC transmitter, and
        # the vehicle just sits armed on the ground until DISARM_DELAY
        # kicks in. Confirmed via the same PARAM_VALUE echo pattern as
        # RTL_ALT(_M) below, since PARAM_SET is fire-and-forget over UDP.
        self._auto_options_configured: bool = False
        # WP_YAW_BEHAVIOR default (LOOK_AT_NEXT_WP_EXCEPT_RTL = 2) makes
        # ArduCopter deliberately hold the last heading during any RTL leg
        # - including RTL-as-a-mission-item (Return to Home) - instead of
        # turning to face the direction of travel like it does for normal
        # waypoints. Forcing LOOK_AT_NEXT_WP (1) makes it turn during RTL
        # too, confirmed via the same PARAM_VALUE echo pattern.
        self._wp_yaw_behavior_configured: bool = False
        self._wp_yaw_behavior_last_attempt_monotonic: float = 0.0
        # How many synthetic items (e.g. a prepended NAV_TAKEOFF) were
        # uploaded ahead of the operator's actual waypoints in the current
        # mission, so MISSION_CURRENT's raw seq can be translated back into
        # a 0-indexed position in `_state.mission_waypoints`.
        self._mission_seq_offset: int = 0
        self._thread = threading.Thread(target=self._run, daemon=True, name="mavlink-client")

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=2)

    def get_state(self) -> TelemetryState:
        with self._lock:
            return self._state.model_copy()

    def submit_command(self, name: str, client_timeout: Optional[float] = None, **kwargs) -> CommandResult:
        """Blocking call — run via asyncio.to_thread from request handlers."""
        request = _CommandRequest(name, kwargs)
        self._command_queue.put(request)
        wait_timeout = client_timeout if client_timeout is not None else settings.command_ack_timeout_seconds + 2
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
            self._ensure_rtl_alt_configured()
            self._ensure_home_position()
            self._ensure_wp_yaw_behavior_configured()

    def _connect(self) -> None:
        self._rtl_alt_configured = False
        self._wp_yaw_behavior_configured = False
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

    def _ensure_rtl_alt_configured(self) -> None:
        """Setting the RTL-climb-altitude parameter to 0 tells ArduCopter's
        RTL to hold the current altitude on the way home instead of first
        climbing to its default RTL altitude (~15m). The parameter was
        renamed from `RTL_ALT` (centimeters) to `RTL_ALT_M` (meters) in
        recent ArduCopter builds as part of a metric-units migration, so
        both names are set here for compatibility across versions. PARAM_SET
        is fire-and-forget over UDP, so this retries every few seconds until
        ArduCopter's PARAM_VALUE echo confirms one of them actually took
        (see the PARAM_VALUE branch in _handle_message), rather than
        assuming success as soon as the request is sent."""
        if self._rtl_alt_configured or self._master is None:
            return
        with self._lock:
            if not self._state.connected:
                return
        now = time.monotonic()
        if now - self._rtl_alt_last_attempt_monotonic < RTL_ALT_RETRY_INTERVAL_SECONDS:
            return
        self._rtl_alt_last_attempt_monotonic = now
        # target_component from the connection defaults to 0 ("broadcast"),
        # which ArduCopter's parameter subsystem silently ignores - unlike
        # COMMAND_LONG, it wants the autopilot's exact component ID.
        for param_name in (b"RTL_ALT_M", b"RTL_ALT"):
            self._master.mav.param_set_send(
                self._master.target_system,
                mavutil.mavlink.MAV_COMP_ID_AUTOPILOT1,
                param_name,
                0.0,
                mavutil.mavlink.MAV_PARAM_TYPE_REAL32,
            )
        logger.info("Requesting RTL_ALT(_M)=0 (RTL should hold current altitude, no forced climb)")

    def _ensure_home_position(self) -> None:
        """ArduCopter broadcasts HOME_POSITION once on its own shortly after
        the EKF origin is set, but doesn't repeat it - explicitly requesting
        it (and retrying, since the request is fire-and-forget over UDP)
        means the frontend's home "H" marker doesn't depend on catching that
        one broadcast at exactly the right moment after a backend restart."""
        if self._state.home_lat is not None or self._master is None:
            return
        with self._lock:
            if not self._state.connected:
                return
        now = time.monotonic()
        if now - self._home_position_last_attempt_monotonic < RTL_ALT_RETRY_INTERVAL_SECONDS:
            return
        self._home_position_last_attempt_monotonic = now
        self._master.mav.command_long_send(
            self._master.target_system,
            self._master.target_component,
            mavutil.mavlink.MAV_CMD_GET_HOME_POSITION,
            0, 0, 0, 0, 0, 0, 0, 0,
        )

    def _ensure_wp_yaw_behavior_configured(self) -> None:
        """WP_YAW_BEHAVIOR defaults to LOOK_AT_NEXT_WP_EXCEPT_RTL (2), so
        ArduCopter deliberately holds the last heading during any RTL leg -
        whether triggered by the standalone RTL command or by a
        MAV_CMD_NAV_RETURN_TO_LAUNCH mission item (Return to Home) -
        instead of turning to face the direction of travel like it does for
        ordinary waypoints. Forcing LOOK_AT_NEXT_WP (1) makes it turn during
        RTL too."""
        if self._wp_yaw_behavior_configured or self._master is None:
            return
        with self._lock:
            if not self._state.connected:
                return
        now = time.monotonic()
        if now - self._wp_yaw_behavior_last_attempt_monotonic < RTL_ALT_RETRY_INTERVAL_SECONDS:
            return
        self._wp_yaw_behavior_last_attempt_monotonic = now
        self._master.mav.param_set_send(
            self._master.target_system,
            mavutil.mavlink.MAV_COMP_ID_AUTOPILOT1,
            b"WP_YAW_BEHAVIOR",
            1.0,
            mavutil.mavlink.MAV_PARAM_TYPE_INT8,
        )

    def _check_search_arrival(self) -> None:
        with self._lock:
            has_target = self._state.search_target_lat is not None and self._state.search_target_lon is not None
            en_route = has_target and not self._state.search_arrived and self._state.flight_mode == "GUIDED"
            if not en_route or self._state.lat is None or self._state.lon is None:
                return
            target_lat, target_lon = self._state.search_target_lat, self._state.search_target_lon
            cur_lat, cur_lon = self._state.lat, self._state.lon
        distance = _haversine_meters(target_lat, target_lon, cur_lat, cur_lon)
        if distance <= SEARCH_ARRIVAL_RADIUS_METERS:
            logger.info("Arrived at search point (%.1fm), holding position", distance)
            with self._lock:
                self._state.search_arrived = True

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
                self._state.vertical_speed = msg.climb
                if self._state.heading is None:
                    self._state.heading = msg.heading
            elif msg_type == "ATTITUDE":
                self._state.roll = math.degrees(msg.roll)
                self._state.pitch = math.degrees(msg.pitch)
                self._state.yaw = math.degrees(msg.yaw) % 360.0
            elif msg_type == "HOME_POSITION":
                self._state.home_lat = msg.latitude / 1e7
                self._state.home_lon = msg.longitude / 1e7
            elif msg_type == "MISSION_CURRENT":
                if self._state.mission_active and self._state.mission_total:
                    # Clamp so a trailing return-to-home item (past the
                    # last real waypoint) doesn't index past the end of
                    # mission_waypoints on the frontend.
                    adjusted = msg.seq - self._mission_seq_offset
                    self._state.mission_current_seq = max(0, min(adjusted, self._state.mission_total - 1))
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
            elif msg_type == "PARAM_VALUE":
                # ArduPilot echoes every applied PARAM_SET back as PARAM_VALUE
                # - this is the actual confirmation that RTL_ALT(_M)=0 took,
                # since PARAM_SET itself is fire-and-forget over UDP.
                param_id = msg.param_id
                if isinstance(param_id, bytes):
                    param_id = param_id.decode(errors="replace")
                param_id = param_id.rstrip("\x00")
                if param_id in ("RTL_ALT_M", "RTL_ALT") and abs(msg.param_value) < 0.5:
                    if not self._rtl_alt_configured:
                        logger.info("Confirmed %s=0 (RTL will hold current altitude)", param_id)
                    self._rtl_alt_configured = True
                elif param_id == "AUTO_OPTIONS" and int(msg.param_value) & 2:
                    if not self._auto_options_configured:
                        logger.info("Confirmed AUTO_OPTIONS bit1 set (AUTO takeoff won't wait for RC throttle)")
                    self._auto_options_configured = True
                elif param_id == "WP_YAW_BEHAVIOR" and int(msg.param_value) == 1:
                    if not self._wp_yaw_behavior_configured:
                        logger.info("Confirmed WP_YAW_BEHAVIOR=1 (vehicle will yaw to face travel direction during RTL too)")
                    self._wp_yaw_behavior_configured = True
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
        with self._lock:
            if name != "search":
                # Every other command supersedes any in-progress search —
                # clear it so the arrival check doesn't later flip
                # search_arrived after the new command has moved on.
                self._state.search_target_lat = None
                self._state.search_target_lon = None
                self._state.search_arrived = False
            if name != "mission_start":
                # Every other command (including mission_cancel itself)
                # supersedes an active mission.
                self._state.mission_active = False
                self._state.mission_waypoints = None
                self._state.mission_total = None
                self._state.mission_current_seq = None
                self._state.mission_return_to_home = False
        if name == "arm":
            return self._cmd_arm()
        if name == "disarm":
            return self._cmd_disarm()
        if name == "takeoff":
            return self._cmd_takeoff(kwargs.get("altitude", 10.0))
        if name == "land":
            return self._cmd_land()
        if name == "rtl":
            return self._cmd_rtl()
        if name == "search":
            return self._cmd_search(kwargs["lat"], kwargs["lon"], kwargs.get("altitude"))
        if name == "cancel_search":
            # The clearing block above already stopped the arrival check;
            # in GUIDED mode the vehicle simply holds its last commanded
            # position once no new setpoint follows.
            return CommandResult(success=True, message="Search cancelled — holding position")
        if name == "mission_start":
            return self._cmd_mission_start(kwargs["waypoints"], kwargs.get("return_to_home", False))
        if name == "mission_cancel":
            return self._cmd_mission_cancel()
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

    def _cmd_land(self) -> CommandResult:
        if self._set_mode("LAND"):
            return CommandResult(success=True, message="Land engaged", mav_result="MODE_CHANGED")
        return CommandResult(success=False, message="Land failed: could not switch to LAND mode")

    def _cmd_rtl(self) -> CommandResult:
        if self._set_mode("RTL"):
            return CommandResult(success=True, message="RTL engaged", mav_result="MODE_CHANGED")
        return CommandResult(success=False, message="RTL failed: could not switch to RTL mode")

    def _cmd_search(self, lat: float, lon: float, altitude: Optional[float] = None) -> CommandResult:
        target_alt = altitude if altitude is not None else (self._state.alt_relative or 15.0)
        # A fresh search command always restarts the en-route -> arrived
        # cycle at the new point, even if we'd already arrived at a
        # previous one.
        with self._lock:
            self._state.search_arrived = False

        airborne = (self._state.alt_relative or 0) > 0.5
        if not airborne:
            if not self._set_mode("GUIDED"):
                return CommandResult(success=False, message="Search failed: could not switch to GUIDED mode for takeoff")
            takeoff_ack = self._send_command_long(mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, param7=target_alt)
            takeoff_result = self._ack_to_result(takeoff_ack, "Search takeoff")
            if not takeoff_result.success:
                return takeoff_result
            # Climb to (near) the full search altitude before moving
            # horizontally, so the vehicle goes straight up then straight
            # across rather than climbing and translating at the same time.
            # (A small liftoff-only wait isn't enough here: DO_REPOSITION's
            # altitude target would just get blended with the still-climbing
            # NAV_TAKEOFF, moving and climbing simultaneously.)
            climb_target = target_alt * 0.95
            climb_timeout = min(max(15.0, target_alt * 1.2), 60.0)
            climbed = self._wait_until(lambda: (self._state.alt_relative or 0) >= climb_target, timeout=climb_timeout)
            if not climbed:
                return CommandResult(success=False, message="Search failed: vehicle did not reach search altitude in time")

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
            result.message = f"Heading to search point ({lat:.5f}, {lon:.5f}) at {target_alt:.0f}m"
        return result

    def _cmd_mission_start(self, waypoints: list[dict], return_to_home: bool = False) -> CommandResult:
        """Upload a multi-waypoint AUTO mission (QGroundControl-style) and
        start flying it. If the vehicle is grounded, a NAV_TAKEOFF item is
        prepended so AUTO mode climbs out on its own first, exactly like a
        real GCS-planned mission with a takeoff item."""
        if not waypoints:
            return CommandResult(success=False, message="Mission failed: no waypoints provided")

        grounded = (self._state.alt_relative or 0) <= 0.5
        # ArduPilot reserves mission seq 0 for the home position
        # (AP_MISSION_FIRST_REAL_COMMAND == 1) - actual commands must start
        # at seq 1 or AUTO mode's takeoff-command scan never finds them and
        # refuses to start ("Auto: Missing Takeoff Cmd"), even if a real
        # NAV_TAKEOFF item is sitting at seq 0.
        home_lat = self._state.lat or 0.0
        home_lon = self._state.lon or 0.0
        items: list[dict] = [
            {
                "frame": mavutil.mavlink.MAV_FRAME_GLOBAL,
                "command": mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
                "param4": float("nan"),
                "x": int(home_lat * 1e7),
                "y": int(home_lon * 1e7),
                "z": 0,
            }
        ]
        if grounded:
            items.append(
                {
                    "frame": mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
                    "command": mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                    "param4": float("nan"),
                    "x": 0,
                    "y": 0,
                    "z": waypoints[0]["altitude"],
                }
            )
        for wp in waypoints:
            items.append(
                {
                    "frame": mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
                    "command": mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
                    "param4": float("nan"),
                    "x": int(wp["lat"] * 1e7),
                    "y": int(wp["lon"] * 1e7),
                    "z": wp["altitude"],
                }
            )
        if return_to_home:
            # Ends the mission with a real RTL item, so ArduCopter flies
            # home and lands on its own once the last waypoint is reached -
            # reuses the same RTL behavior (hold-altitude-then-land) as the
            # standalone RTL command, since it's the same underlying logic.
            items.append(
                {
                    "frame": mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
                    "command": mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
                    "x": 0,
                    "y": 0,
                    "z": 0,
                }
            )

        if not self._ensure_auto_options_configured():
            return CommandResult(success=False, message="Mission failed: could not configure AUTO_OPTIONS for RC-less takeoff")

        if not self._upload_mission(items):
            return CommandResult(success=False, message="Mission failed: upload rejected or timed out")

        self._mission_seq_offset = 2 if grounded else 1
        # Seq 1 is always the first real command (takeoff when grounded,
        # otherwise the first waypoint) — seq 0 is the reserved home slot.
        self._master.mav.mission_set_current_send(self._master.target_system, self._master.target_component, 1)

        if not self._set_mode("AUTO"):
            return CommandResult(success=False, message="Mission uploaded but failed to switch to AUTO mode")

        with self._lock:
            self._state.mission_active = True
            self._state.mission_waypoints = [MissionWaypoint(**wp) for wp in waypoints]
            self._state.mission_total = len(waypoints)
            self._state.mission_current_seq = 0
            self._state.mission_return_to_home = return_to_home

        return CommandResult(
            success=True,
            message=f"Mission started — {len(waypoints)} waypoint(s), AUTO engaged",
            mav_result="MODE_CHANGED",
        )

    def _cmd_mission_cancel(self) -> CommandResult:
        mode_switched = self._set_mode("GUIDED")
        self._master.mav.mission_clear_all_send(
            self._master.target_system, self._master.target_component, mavutil.mavlink.MAV_MISSION_TYPE_MISSION
        )
        with self._lock:
            self._state.mission_active = False
            self._state.mission_waypoints = None
            self._state.mission_total = None
            self._state.mission_current_seq = None
            self._state.mission_return_to_home = False
        message = "Mission cancelled — holding position" if mode_switched else "Mission cancelled (mode switch failed)"
        return CommandResult(success=mode_switched, message=message)

    def _ensure_auto_options_configured(self) -> bool:
        if self._auto_options_configured:
            return True
        self._master.mav.param_set_send(
            self._master.target_system,
            mavutil.mavlink.MAV_COMP_ID_AUTOPILOT1,
            b"AUTO_OPTIONS",
            2.0,  # bit 1 = AllowTakeOffWithoutRaisingThrottle
            mavutil.mavlink.MAV_PARAM_TYPE_INT32,
        )
        return self._wait_until(lambda: self._auto_options_configured, timeout=5.0)

    def _upload_mission(self, items: list[dict]) -> bool:
        """Runs the MAVLink mission upload handshake: announce the item
        count, then answer each MISSION_REQUEST_INT the vehicle sends (it
        pulls items one at a time, not necessarily in order) until it sends
        back a MISSION_ACK. Fire-and-forget MISSION_COUNT alone isn't
        enough — the vehicle drives this exchange, so we just have to keep
        answering until it's satisfied or we time out."""
        count = len(items)
        self._master.mav.mission_count_send(
            self._master.target_system, self._master.target_component, count, mavutil.mavlink.MAV_MISSION_TYPE_MISSION
        )
        deadline = time.monotonic() + MISSION_UPLOAD_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            remaining = max(0.0, deadline - time.monotonic())
            msg = self._master.recv_match(blocking=True, timeout=min(POLL_TIMEOUT_SECONDS, remaining))
            if msg is None:
                continue
            msg_type = msg.get_type()
            if msg_type in ("MISSION_REQUEST_INT", "MISSION_REQUEST"):
                seq = msg.seq
                if seq >= count:
                    continue
                item = items[seq]
                self._master.mav.mission_item_int_send(
                    self._master.target_system,
                    self._master.target_component,
                    seq,
                    item["frame"],
                    item["command"],
                    0,  # current — ignored by ArduCopter during upload, set via mission_set_current afterwards
                    1,  # autocontinue
                    item.get("param1", 0), item.get("param2", 0), item.get("param3", 0), item.get("param4", 0),
                    item["x"], item["y"], item["z"],
                    mavutil.mavlink.MAV_MISSION_TYPE_MISSION,
                )
            elif msg_type == "MISSION_ACK":
                if msg.type != mavutil.mavlink.MAV_MISSION_ACCEPTED:
                    result_enum = mavutil.mavlink.enums.get("MAV_MISSION_RESULT", {})
                    entry = result_enum.get(msg.type)
                    logger.warning("Mission upload rejected: %s", entry.name if entry else msg.type)
                return msg.type == mavutil.mavlink.MAV_MISSION_ACCEPTED
            else:
                self._handle_message(msg)
        return False

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
