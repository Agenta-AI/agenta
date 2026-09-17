"""Where the integration layer's Postgres actually is, from wherever pytest is running.

Two addresses for one server, and only one of them moves.

Inside the compose network it is `postgres:5432`, which is what every container reads out of
the deployment's env file and is correct there. On the host that same server is reached
through a **published** port, which `env.sh` allocates per worktree so two stacks can run
side by side, and which the stack's own env file records as `POSTGRES_PORT`. Those are
different numbers, and reading the in-network one as the host one is how a host-side run
dials somebody else's deployment or nothing at all (D97). The mock-gateway addresses had the
same two meanings and the same defect (D76); this is the same fix for the database.

The check opens a real connection rather than a TCP probe: reaching the port proves a server
is listening, not that this deployment's database is there. But the port is what identifies
the deployment now, not the database name. The name separates licences and nothing else —
every EE stack on a box calls its database `agenta_ee_core`, so a run that fell back to
`127.0.0.1:5432` and found an EE stack there would have seeded projects and executed against
a deployment nobody named.
"""

import asyncio
import os
from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse, urlunparse

from oss.src.utils.env import env

# What the server listens on inside the compose network. Fixed, because the published port is
# remapped onto it, so it is never the value that moves.
_CONTAINER_PORT = 5432


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


def published_port() -> Optional[int]:
    """The host port compose published for this stack's Postgres, if its env file says.

    `None` means nothing declared one, which is a stack that predates the allocation and
    publishes on the container port. A malformed value is the operator's to see rather than
    something to fall back from: falling back silently is how a suite ends up dialling a port
    nobody asked for.
    """
    raw = (os.getenv("POSTGRES_PORT") or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        raise AssertionError(f"POSTGRES_PORT is not a port number: {raw!r}") from None


def _on_loopback(uri: str) -> str:
    """The same server as the host reaches it: loopback, on the PUBLISHED port.

    Keeping the in-network port here was D97. `postgres:5432` became `127.0.0.1:5432`, which
    on a box running several stacks is whichever one happened to bind 5432, and on this one
    was an unrelated deployment.
    """
    parsed = urlparse(uri)
    userinfo = parsed.netloc.rsplit("@", 1)[0] if "@" in parsed.netloc else ""
    port = published_port() or parsed.port or _CONTAINER_PORT
    host = f"127.0.0.1:{port}"
    return urlunparse(
        parsed._replace(netloc=f"{userinfo}@{host}" if userinfo else host)
    )


@lru_cache(maxsize=1)
def resolve_core_uri() -> Optional[str]:
    """The core URI as configured, else the same database via published loopback.

    None means this deployment's Postgres is not reachable. Callers in the integration layer
    must not read that as "skip": see :func:`require_core_uri`.
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


def require_core_uri() -> str:
    """The resolved URI, or a failure that says what to do about it.

    The integration layer exists to run against a deployment's database. A layer that skips
    when it cannot find one reports a green run in which almost nothing executed: against the
    stack this was written for, 93 of 101 cases skipped and the process exited 0 (D97). A
    release gate reading the exit code, or the last line, is then told the suite passed.

    So the absence of a database is a failure here, and the sentence names the two variables
    that fix it rather than the fact that something was unreachable.
    """
    resolved = use_reachable_core_uri()
    if resolved is not None:
        return resolved

    configured = env.postgres.uri_core
    port = published_port()
    raise AssertionError(
        "The integration layer could not reach this deployment's Postgres. It tried "
        f"{_redacted(configured)} and {_redacted(_on_loopback(configured))}. "
        "Point it at the stack under test: POSTGRES_URI_CORE for the database, or "
        "POSTGRES_PORT for the host port compose published "
        f"(read {'as ' + str(port) if port is not None else 'nowhere'}). "
        "Both are in the stack's env file; `load-env <env-file>` exports them."
    )


def _redacted(uri: str) -> str:
    """The address without the credentials, for a message that goes into a test log."""
    parsed = urlparse(uri)
    host = parsed.netloc.rsplit("@", 1)[-1]
    return urlunparse(parsed._replace(netloc=host))
