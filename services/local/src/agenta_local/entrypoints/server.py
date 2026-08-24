"""Entrypoint: run the local service under uvicorn with graceful shutdown."""

import os

import uvicorn

from ..apis.fastapi.app import create_app
from ..config import Settings
from ..launcher.lock import WorkspaceLock, WorkspaceLocked


def main() -> int:
    # Single-user loopback deployment: the SDK's egress guard must permit the
    # co-located runner (trusted/single-tenant case it documents).
    os.environ.setdefault("AGENTA_INSECURE_EGRESS_ALLOWED", "true")
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    settings.data_dir.chmod(0o700)
    try:
        lock = (
            WorkspaceLock.inherited(
                settings.lock_path, settings.lock_fd, settings.data_dir
            )
            if settings.lock_fd is not None
            else WorkspaceLock.acquire(settings.lock_path, settings.data_dir)
        )
    except WorkspaceLocked as exc:
        print(str(exc))
        return 2
    except OSError as exc:
        print(f"cannot acquire workspace lock {settings.lock_path}: {exc}")
        return 1

    with lock:
        app = create_app(settings)
        config = uvicorn.Config(
            app,
            host=settings.host,
            port=settings.port,
            log_level="info",
            access_log=False,
        )
        server = uvicorn.Server(config)

        def request_shutdown() -> None:
            server.should_exit = True

        app.state.request_shutdown = request_shutdown
        server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
