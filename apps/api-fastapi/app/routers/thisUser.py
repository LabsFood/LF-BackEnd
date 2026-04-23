from fastapi import APIRouter, Depends

from ..auth import ClerkUser, require_clerk_user


router = APIRouter(prefix="/thisUser", tags=["thisUser"])


@router.get("")
def read_thisUser(user: ClerkUser = Depends(require_clerk_user)) -> dict[str, str | None]:
    """Return the authenticated Clerk user's identifiers (protected sample route)."""
    return {
        "user_id": user.user_id,
        "session_id": user.session_id,
        "email": user.email,
    }
