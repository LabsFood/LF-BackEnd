"""Cronofy placeholder client."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from ..config import get_settings


@dataclass
class CronofyClient:
    client_id: str | None
    client_secret: str | None
    data_center: str

    @property
    def configured(self) -> bool:
        """Whether both Cronofy OAuth client credentials are present."""
        return bool(self.client_id and self.client_secret)

    @property
    def base_url(self) -> str:
        """Build the regional Cronofy API base URL from the configured data center."""
        dc = self.data_center.strip() or "us"
        prefix = "" if dc == "us" else f"{dc}-"
        return f"https://api-{prefix}cronofy.com/v1"

    def http(self) -> httpx.Client:
        """Return a short-lived HTTP client pointed at the Cronofy base URL."""
        return httpx.Client(base_url=self.base_url, timeout=10.0)


_settings = get_settings()
cronofy_client = CronofyClient(
    client_id=_settings.cronofy_client_id,
    client_secret=_settings.cronofy_client_secret,
    data_center=_settings.cronofy_data_center,
)
