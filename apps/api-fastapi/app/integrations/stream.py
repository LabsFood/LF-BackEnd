"""Stream chat placeholder client."""

from __future__ import annotations

from dataclasses import dataclass

from ..config import get_settings


@dataclass
class StreamClient:
    api_key: str | None
    api_secret: str | None
    app_id: str | None

    @property
    def configured(self) -> bool:
        """Whether Stream API key and secret were both provided via env."""
        return bool(self.api_key and self.api_secret)


_settings = get_settings()
stream_client = StreamClient(
    api_key=_settings.stream_api_key,
    api_secret=_settings.stream_api_secret,
    app_id=_settings.stream_app_id,
)
