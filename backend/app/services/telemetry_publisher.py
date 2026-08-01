import asyncio
import logging

from ..config import settings
from ..mavlink_client import mavlink_manager
from ..redis_bridge import publish_state

logger = logging.getLogger("telemetry_publisher")


async def run_telemetry_publisher(stop_event: asyncio.Event) -> None:
    """Polls the MAVLink manager's in-memory state and republishes it to
    Redis at a fixed rate, decoupling telemetry ingestion (blocking MAVLink
    thread) from delivery (async WebSocket fanout)."""
    interval = 1.0 / settings.telemetry_publish_hz
    while not stop_event.is_set():
        try:
            state = mavlink_manager.get_state()
            await publish_state(state)
        except Exception:  # noqa: BLE001 - keep publishing loop alive
            logger.exception("Failed to publish telemetry state")
        await asyncio.sleep(interval)
