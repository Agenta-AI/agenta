"""Where the integration layer's Postgres actually is, from wherever pytest is running.

The application default names the compose host (`postgres:5432`), which is correct for
every container and unreachable from the host that started them. Compose publishes the
same server on loopback, so a host-side run reaches it without the deployment's env file
having to be edited — the containers read that same file and need the service name.

The check opens a real connection rather than a TCP probe: reaching the port proves a
server is listening, not that this deployment's database is there. A stack deployed under
a different `AGENTA_LICENSE` listens on the same port with different database names, and
a TCP probe would send the suite into it and fail every test instead of skipping.
"""

import asyncio
from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse, urlunparse

from oss.src.utils.env import env


async def _can_connect(dsn: str) -> bool:
    import asyncpg

    try:
        connection = await asyncio.wait_for(asyncpg.connect(dsn), timeout=2.0)
    except (OSError, asyncio.TimeoutError, asyncpg.PostgresError):
        return False

    await connection.close()
    return True


def _connectable(uri: str) -> bool:
    dsn = uri.replace("postgresql+asyncpg://", "postgresql://")
    try:
        return asyncio.run(_can_connect(dsn))
    except RuntimeError:  # already inside a loop; assume usable and let the test say
        return True


def _on_loopback(uri: str) -> str:
    parsed = urlparse(uri)
    userinfo = parsed.netloc.rsplit("@", 1)[0] if "@" in parsed.netloc else ""
    host = f"127.0.0.1:{parsed.port or 5432}"
    return urlunparse(
        parsed._replace(netloc=f"{userinfo}@{host}" if userinfo else host)
    )


@lru_cache(maxsize=1)
def resolve_core_uri() -> Optional[str]:
    """The core URI as configured, else the same database via published loopback.

    None means this deployment's Postgres is not reachable and the caller should skip.
    """
    uri = env.postgres.uri_core
    if _connectable(uri):
        return uri

    loopback = _on_loopback(uri)
    if loopback != uri and _connectable(loopback):
        return loopback

    return None


def use_reachable_core_uri() -> Optional[str]:
    """Point the shared `env` at the resolved URI so engines built later use it."""
    resolved = resolve_core_uri()
    if resolved is not None:
        env.postgres.uri_core = resolved
    return resolved
