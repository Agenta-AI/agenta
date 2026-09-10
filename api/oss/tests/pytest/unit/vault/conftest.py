import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

from oss.src.utils.env import env


@lru_cache(maxsize=1)
def _postgres_reachable() -> bool:
    """TCP-probe the configured core Postgres once per session.

    Mirrors the session/git DAO suites: the vault DAO integration tests need a real
    Postgres (advisory locks are a server feature), and the default URI points at the
    Docker-network host `postgres:5432`, which does not resolve on a bare host. Probe
    rather than error so a native run skips these instead of failing setup.
    """
    parsed = urlparse(env.postgres.uri_core)
    host = parsed.hostname or "postgres"
    port = parsed.port or 5432
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


@pytest.fixture(autouse=True)
def _skip_when_postgres_unreachable(request):
    if request.node.get_closest_marker("integration") and not _postgres_reachable():
        pytest.skip("Postgres not reachable — skipping vault DAO integration tests")
