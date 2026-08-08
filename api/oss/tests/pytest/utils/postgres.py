import socket
from functools import lru_cache
from urllib.parse import urlparse

from oss.src.utils.env import env


@lru_cache(maxsize=1)
def postgres_reachable() -> bool:
    """TCP-probe the configured core Postgres once per session.

    Integration and database-adjacent acceptance tests need a running Postgres.
    Probe rather than let the connection raise, so a run without a stack skips
    instead of erroring — an errored suite and a skipped suite read very
    differently to whoever ran it.
    """
    parsed = urlparse(env.postgres.uri_core)
    host = parsed.hostname or "postgres"
    port = parsed.port or 5432
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False
