import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .mavlink_client import mavlink_manager
from .redis_bridge import close_redis
from .routers import commands, websocket as websocket_router
from .services.telemetry_publisher import run_telemetry_publisher

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    mavlink_manager.start()
    stop_event = asyncio.Event()
    publisher_task = asyncio.create_task(run_telemetry_publisher(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await publisher_task
        mavlink_manager.stop()
        await close_redis()


app = FastAPI(title="SAR Mission Control API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(commands.router)
app.include_router(websocket_router.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
