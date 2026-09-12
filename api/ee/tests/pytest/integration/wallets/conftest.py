import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

import oss.src.dbs.redis.shared.engine as redis_engine_module
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


@pytest.fixture(autouse=True)
async def _fresh_streams_engine_per_test():
    """The durable-Redis streams engine is a process-wide singleton holding one client,
    and pytest-asyncio gives each test its own event loop — a client built in an earlier
    test's loop fails every publish made here, and `_xadd` swallows that into a bare
    `False`. Rebuild it per test, the way these modules rebuild the Postgres transactions
    engine."""
    redis_engine_module._streams_engine = None
    yield
    if redis_engine_module._streams_engine is not None:
        await redis_engine_module._streams_engine.close()
        redis_engine_module._streams_engine = None
