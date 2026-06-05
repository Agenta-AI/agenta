"""Server-side env-derived settings.

Loaded from ``draft/.env`` once at import. The runtime and persona are NOT
configured here — both come from the request (route + body) so the same
running server can serve all four runtimes against any persona.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_DRAFT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_DRAFT_ROOT / ".env")


class Settings:
    # In-memory SQLite by default — fresh seed every server restart, no
    # idempotency concerns. State survives across requests within one process.
    # Set HOTEL_DB_URL to an on-disk path if persistence is wanted (e.g. for
    # debugging), and clean the file before restart.
    DB_URL: str = os.getenv("HOTEL_DB_URL", "sqlite+aiosqlite:///:memory:")

    # Default persona when the frontend doesn't provide one.
    DEFAULT_PERSONA: str = os.getenv("DEFAULT_PERSONA", "guest_sarah")

    # Frontend dev-server origin for CORS during local dev.
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")

    # Tracing backend: "agenta" (default) or "logfire". Controls how spans
    # are exported in main.py's startup configuration.
    TRACING_BACKEND: str = os.getenv("TRACING_BACKEND", "agenta")

    # Agenta — used for the agenta tracing backend and *_with_agenta runtimes.
    AGENTA_API_KEY: str = os.getenv("AGENTA_API_KEY", "")
    AGENTA_HOST: str = os.getenv("AGENTA_HOST", "https://cloud.agenta.ai")

    # Logfire token for the "logfire" tracing backend. The .env names this
    # LOGFIRE_API_KEY; fall back to LOGFIRE_TOKEN for compatibility.
    LOGFIRE_TOKEN: str = os.getenv("LOGFIRE_API_KEY", "") or os.getenv("LOGFIRE_TOKEN", "")


settings = Settings()
