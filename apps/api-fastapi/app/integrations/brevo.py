"""Brevo (transactional email) placeholder client."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from ..config import get_settings


BREVO_BASE_URL = "https://api.brevo.com/v3"


@dataclass
class BrevoClient:
    api_key: str | None
    sender_email: str
    sender_name: str

    @property
    def configured(self) -> bool:
        """Whether a Brevo API key was loaded from env."""
        return bool(self.api_key)

    def http(self) -> httpx.Client:
        """Return a short-lived HTTP client with Brevo auth headers pre-set."""
        headers = {"accept": "application/json", "content-type": "application/json"}
        if self.api_key:
            headers["api-key"] = self.api_key
        return httpx.Client(base_url=BREVO_BASE_URL, headers=headers, timeout=10.0)


_settings = get_settings()
brevo_client = BrevoClient(
    api_key=_settings.brevo_api_key,
    sender_email=_settings.brevo_sender_email,
    sender_name=_settings.brevo_sender_name,
)
