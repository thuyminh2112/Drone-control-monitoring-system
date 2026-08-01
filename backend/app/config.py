import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    mavlink_connection: str = os.getenv("MAVLINK_CONNECTION", "udpin:127.0.0.1:14560")
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    cors_origin: str = os.getenv("CORS_ORIGIN", "http://localhost:5173")
    heartbeat_timeout_seconds: float = float(os.getenv("HEARTBEAT_TIMEOUT_SECONDS", "5"))
    command_ack_timeout_seconds: float = float(os.getenv("COMMAND_ACK_TIMEOUT_SECONDS", "5"))

    telemetry_channel: str = "drone:telemetry"
    telemetry_state_key: str = "drone:latest_state"
    telemetry_publish_hz: float = 2.0


settings = Settings()
