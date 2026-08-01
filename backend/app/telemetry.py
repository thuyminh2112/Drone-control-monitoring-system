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

    # Set while a "fly to point and orbit" search command is active; cleared
    # by Arm/Disarm/Takeoff/RTL. `orbiting` flips true once the vehicle has
    # arrived and the backend is actively driving a GUIDED-mode orbit
    # around the target (see mavlink_client._drive_orbit).
    search_target_lat: Optional[float] = None
    search_target_lon: Optional[float] = None
    orbiting: bool = False

    last_heartbeat: Optional[datetime] = None
    timestamp: datetime = datetime.now(timezone.utc)

    class Config:
        json_encoders = {datetime: lambda dt: dt.isoformat()}


class CommandResult(BaseModel):
    success: bool
    message: str
    mav_result: Optional[str] = None
