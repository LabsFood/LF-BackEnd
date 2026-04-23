"""HTTP routers exposed by the FastAPI app.

Importing the submodules here gives the application a single, explicit list
of available routers and avoids deep relative imports in ``app.main``.
"""

from . import bookings, health, thisUser

__all__ = ["bookings", "health", "thisUser"]
