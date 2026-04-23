"""Stripe placeholder client.

Phase 1 only validates configuration and exposes a typed surface.
Payment intent creation lands in Phase 2 alongside the bookings flow.
"""

from __future__ import annotations

from dataclasses import dataclass

import stripe

from ..config import get_settings


@dataclass
class StripeClient:
    api_key: str | None

    @property
    def configured(self) -> bool:
        """Whether a Stripe secret key was loaded from env."""
        return bool(self.api_key)

    def bind(self) -> None:
        """Attach the loaded secret key to the global ``stripe`` module, if any."""
        if self.api_key:
            stripe.api_key = self.api_key


_settings = get_settings()
stripe_client = StripeClient(api_key=_settings.stripe_secret_key)
stripe_client.bind()
