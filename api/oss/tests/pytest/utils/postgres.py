import socket
from functools import lru_cache
from urllib.parse import urlparse

from oss.src.utils.env import env


def _postgres_host_port() -> tuple:
    parsed = urlparse(env.postgres.uri_core)
    return parsed.hostname or "postgres", parsed.port or 5432


@lru_cache(maxsize=1)
def postgres_reachable() -> bool:
    """TCP-probe the configured core Postgres once per session.

    Integration and database-adjacent acceptance tests need a running Postgres.
    Probe rather than let the connection raise, so a run without a stack skips
    instead of erroring — an errored suite and a skipped suite read very
    differently to whoever ran it.
    """
    host, port = _postgres_host_port()
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


def postgres_target() -> str:
    """The host:port postgres_reachable() just probed, for a diagnostic skip reason.

    The default host is the compose-internal name `postgres`, which does not resolve
    outside the compose network — invoking pytest directly (not via py-run-tests, which
    exports POSTGRES_HOST) skips the whole layer even when a Postgres is reachable
    elsewhere. Naming the attempted target turns that into a diagnosable skip.
    """
    host, port = _postgres_host_port()
    return f"{host}:{port}"
