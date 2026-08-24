"""Entrypoint: run the local service under uvicorn with graceful shutdown."""

import os

import uvicorn

from ..apis.fastapi.app import create_app
from ..config import Settings


def main() -> None:
    # Single-user loopback deployment: the SDK's egress guard must permit the
    # co-located runner (trusted/single-tenant case it documents).
    os.environ.setdefault("AGENTA_INSECURE_EGRESS_ALLOWED", "true")
    settings = Settings()
    app = create_app(settings)

    async def _noop() -> None:  # pragma: no cover - uvicorn hook shape
        return None

    config = uvicorn.Config(
        app,
        host=settings.host,
        port=settings.port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)
    app.state.request_shutdown = server.should_exit
    server.run()


if __name__ == "__main__":
    main()
