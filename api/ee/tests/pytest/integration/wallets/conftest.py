import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

from oss.src.utils.env import env


@lru_cache(maxsize=1)
def _postgres_reachable() -> bool:
    """TCP-probe the configured core Postgres once per session. Mirrors
    `oss/tests/pytest/integration/sessions/conftest.py` — these DAO/migration tests need a
    real Postgres reachable at `env.postgres.uri_core`; skip rather than error when it's
    not (e.g. a native run outside docker-compose)."""
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
        pytest.skip("Postgres not reachable — skipping wallet integration tests")
