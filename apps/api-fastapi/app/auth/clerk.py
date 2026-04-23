"""Clerk authentication stub.

Phase 1 implementation verifies the presence of a Bearer token and performs a
permissive decode so downstream code can be built against a stable shape.
Full JWKS-based JWT verification will be wired in a follow-up once Clerk
instance URLs / JWKS endpoints are known.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import jwt
from jose.exceptions import JWTError

from ..config import Settings, get_settings


@dataclass(frozen=True)
class ClerkUser:
    user_id: str
    session_id: Optional[str] = None
    email: Optional[str] = None


def _extract_bearer(authorization: Optional[str]) -> str:
    """Return the raw token from an ``Authorization: Bearer ...`` header or 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return authorization.split(" ", 1)[1].strip()


def require_clerk_user(
    authorization: Optional[str] = Header(default=None),
    settings: Settings = Depends(get_settings),
        ) -> ClerkUser:
    """Protect a route by requiring a Clerk Bearer token and returning its claims."""
    token = _extract_bearer(authorization)

    if not settings.clerk_secret_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Clerk is not configured (CLERK_SECRET_KEY missing)",
        )

    try:
        claims = jwt.get_unverified_claims(token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
        ) from exc

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject claim",
        )

    return ClerkUser(
        user_id=user_id,
        session_id=claims.get("sid"),
        email=claims.get("email"),
    )
