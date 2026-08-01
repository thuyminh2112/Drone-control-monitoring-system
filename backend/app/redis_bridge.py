from typing import Optional

import redis.asyncio as redis

from .config import settings
from .telemetry import TelemetryState

_redis_client: Optional[redis.Redis] = None


def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


async def publish_state(state: TelemetryState) -> None:
    payload = state.model_dump_json()
    client = get_redis()
    await client.set(settings.telemetry_state_key, payload)
    await client.publish(settings.telemetry_channel, payload)


async def get_cached_state() -> Optional[str]:
    client = get_redis()
    return await client.get(settings.telemetry_state_key)


async def close_redis() -> None:
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
