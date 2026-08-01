import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..config import settings
from ..redis_bridge import get_cached_state, get_redis

logger = logging.getLogger("ws")

router = APIRouter()


@router.websocket("/ws/telemetry")
async def telemetry_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    client = get_redis()
    pubsub = client.pubsub()
    await pubsub.subscribe(settings.telemetry_channel)
    try:
        cached = await get_cached_state()
        if cached:
            await websocket.send_text(cached)
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            await websocket.send_text(message["data"])
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await pubsub.unsubscribe(settings.telemetry_channel)
        await pubsub.aclose()
