import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..mavlink_client import mavlink_manager
from ..redis_bridge import get_cached_state
from ..telemetry import CommandResult, TelemetryState

router = APIRouter(prefix="/api/drone", tags=["drone"])


class TakeoffRequest(BaseModel):
    altitude: float = 10.0


class SearchRequest(BaseModel):
    lat: float
    lon: float
    altitude: float = 15.0


@router.get("/state", response_model=TelemetryState)
async def get_state() -> TelemetryState:
    cached = await get_cached_state()
    if cached:
        return TelemetryState.model_validate_json(cached)
    return mavlink_manager.get_state()


@router.post("/arm", response_model=CommandResult)
async def arm() -> CommandResult:
    return await asyncio.to_thread(mavlink_manager.submit_command, "arm")


@router.post("/disarm", response_model=CommandResult)
async def disarm() -> CommandResult:
    return await asyncio.to_thread(mavlink_manager.submit_command, "disarm")


@router.post("/takeoff", response_model=CommandResult)
async def takeoff(body: TakeoffRequest) -> CommandResult:
    state = mavlink_manager.get_state()
    if not state.connected:
        raise HTTPException(status_code=409, detail="Cannot take off: vehicle is not connected")
    if not state.armed:
        raise HTTPException(status_code=409, detail="Cannot take off: vehicle is not armed")
    return await asyncio.to_thread(mavlink_manager.submit_command, "takeoff", altitude=body.altitude)


@router.post("/land", response_model=CommandResult)
async def land() -> CommandResult:
    state = mavlink_manager.get_state()
    if not state.connected:
        raise HTTPException(status_code=409, detail="Cannot land: vehicle is not connected")
    if not state.armed:
        raise HTTPException(status_code=409, detail="Cannot land: vehicle is not armed")
    return await asyncio.to_thread(mavlink_manager.submit_command, "land")


@router.post("/rtl", response_model=CommandResult)
async def rtl() -> CommandResult:
    state = mavlink_manager.get_state()
    if not state.connected:
        raise HTTPException(status_code=409, detail="Cannot RTL: vehicle is not connected")
    return await asyncio.to_thread(mavlink_manager.submit_command, "rtl")


@router.post("/search", response_model=CommandResult)
async def search(body: SearchRequest) -> CommandResult:
    state = mavlink_manager.get_state()
    if not state.connected:
        raise HTTPException(status_code=409, detail="Cannot start search: vehicle is not connected")
    if not state.armed:
        raise HTTPException(status_code=409, detail="Cannot start search: vehicle must be armed")
    if body.altitude < 2.0 or body.altitude > 120.0:
        raise HTTPException(status_code=422, detail="Search altitude must be between 2 and 120 meters")
    # Grounded vehicles climb to the full search altitude before moving
    # horizontally, which can take well past a normal command ack timeout.
    return await asyncio.to_thread(
        mavlink_manager.submit_command,
        "search",
        client_timeout=70.0,
        lat=body.lat,
        lon=body.lon,
        altitude=body.altitude,
    )


@router.post("/search/cancel", response_model=CommandResult)
async def cancel_search() -> CommandResult:
    return await asyncio.to_thread(mavlink_manager.submit_command, "cancel_search")
