from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel


class MissionWaypoint(BaseModel):
    lat: float
    lon: float
    altitude: float


class TelemetryState(BaseModel):
    connected: bool = False
    armed: bool = False
    flight_mode: str = "UNKNOWN"

    battery_percent: Optional[float] = None
    battery_voltage: Optional[float] = None

    lat: Optional[float] = None
    lon: Optional[float] = None
    alt_relative: Optional[float] = None
    alt_msl: Optional[float] = None

    groundspeed: Optional[float] = None
    heading: Optional[float] = None
    vertical_speed: Optional[float] = None

    # The vehicle's launch/home position (from the HOME_POSITION message),
    # shown on the map as the QGroundControl-style "H" marker — a fixed
    # reference point, set once at boot/arm and independent of where the
    # vehicle currently is.
    home_lat: Optional[float] = None
    home_lon: Optional[float] = None

    # Attitude, in degrees, from the ATTITUDE MAVLink message.
    roll: Optional[float] = None
    pitch: Optional[float] = None
    yaw: Optional[float] = None

    # Set while a "fly to point" search command is active; cleared by
    # Arm/Disarm/Takeoff/Land/RTL. `search_arrived` flips true once the
    # vehicle is within arrival radius of the target and holding position
    # there (GUIDED mode holds the last commanded point on its own).
    search_target_lat: Optional[float] = None
    search_target_lon: Optional[float] = None
    search_arrived: bool = False

    # Set while a multi-waypoint AUTO mission (uploaded via the MAVLink
    # mission protocol) is active. `mission_current_seq` is 0-indexed into
    # `mission_waypoints` — the synthetic NAV_TAKEOFF item some missions get
    # prepended with (see MAVLinkManager._cmd_mission_start) is already
    # subtracted out, so index 0 always means "the first waypoint the
    # operator placed", not the takeoff item.
    mission_active: bool = False
    mission_waypoints: Optional[List[MissionWaypoint]] = None
    mission_current_seq: Optional[int] = None
    mission_total: Optional[int] = None
    mission_return_to_home: bool = False

    last_heartbeat: Optional[datetime] = None
    timestamp: datetime = datetime.now(timezone.utc)

    class Config:
        json_encoders = {datetime: lambda dt: dt.isoformat()}


class CommandResult(BaseModel):
    success: bool
    message: str
    mav_result: Optional[str] = None
