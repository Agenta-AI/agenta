import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

from oss.src.utils.env import env


@lru_cache(maxsize=1)
def _postgres_reachable() -> bool:
    """TCP-probe the configured core Postgres once per session.

    The concurrency test needs a real Postgres with two live connections: only a real
    database can prove that `FOR UPDATE` blocks. The default URI points at the
    Docker-network host `postgres:5432`, which resolves in-compose/CI but not on a bare
    host, so probe rather than error and let a native run skip.
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
        pytest.skip("Postgres not reachable — skipping git DAO concurrency tests")
