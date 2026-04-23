from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import ClerkUser, require_clerk_user
from ..database import get_db
from ..models import Booking, BookingStatus


router = APIRouter(prefix="/bookings", tags=["bookings"])


class BookingRead(BaseModel):
    id: UUID
    client_id: UUID
    provider_id: UUID
    service_offer_id: UUID
    starts_at: datetime
    ends_at: datetime
    status: BookingStatus
    price_cents: int
    currency: str

    model_config = {"from_attributes": True}


class BookingCreate(BaseModel):
    provider_id: UUID
    service_offer_id: UUID
    starts_at: datetime
    ends_at: datetime
    price_cents: int = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3, default="EUR")


@router.get("", response_model=list[BookingRead])
def list_bookings(
    _user: ClerkUser = Depends(require_clerk_user),
    db: Session = Depends(get_db),
) -> list[Booking]:
    """List every booking ordered by start time (auth required)."""
    return list(db.execute(select(Booking).order_by(Booking.starts_at)).scalars())


@router.post("", response_model=BookingRead, status_code=status.HTTP_201_CREATED)
def create_booking(
    payload: BookingCreate,
    user: ClerkUser = Depends(require_clerk_user),
    db: Session = Depends(get_db),
) -> Booking:
    """Create a booking (Phase 1 scaffold returns 501 pending Stripe + Cronofy wiring)."""
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ends_at must be after starts_at",
        )

    # Booking persistence, Stripe intent creation, and Cronofy slot reservation
    # land in Phase 2 once the user provisioning flow from Clerk webhooks exists.
    _ = db
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=(
            "Booking creation is not wired yet (Phase 1 scaffold). "
            f"Authenticated as Clerk user {user.user_id}."
        ),
    )
