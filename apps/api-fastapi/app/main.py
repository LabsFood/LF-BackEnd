from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import bookings, health, thisUser


def create_app() -> FastAPI:
    """Build and configure the FastAPI application (CORS, routers, OpenAPI)."""
    settings = get_settings()

    app = FastAPI(
        title="Labs Food API",
        description="Home massage booking backend (FastAPI).",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(thisUser.router)
    app.include_router(bookings.router)

    return app


app = create_app()
