import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

from oss.src.utils.env import env


@lru_cache(maxsize=1)
def _postgres_reachable() -> bool:
    """TCP-probe the configured core Postgres once per session.

    Most acceptance tests speak pure HTTP and run against any deployed stage. A few
    verify server-side effects by reading the database directly, which only works when
    the suite runs adjacent to the stack (compose network or a tunnel). Probe rather
    than error so a remote-stage run skips those instead of failing on name resolution.
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
def _skip_db_adjacent_when_postgres_unreachable(request):
    if request.node.get_closest_marker("integration") and not _postgres_reachable():
        pytest.skip(
            "Postgres not reachable — skipping database-adjacent acceptance tests"
        )
