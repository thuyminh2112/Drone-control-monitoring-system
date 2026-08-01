from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel


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

    last_heartbeat: Optional[datetime] = None
    timestamp: datetime = datetime.now(timezone.utc)

    class Config:
        json_encoders = {datetime: lambda dt: dt.isoformat()}


class CommandResult(BaseModel):
    success: bool
    message: str
    mav_result: Optional[str] = None
