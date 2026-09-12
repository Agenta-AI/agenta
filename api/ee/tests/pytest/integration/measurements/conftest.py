import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

import oss.src.dbs.redis.shared.engine as redis_engine_module
from oss.src.utils.env import env


def _reachable(uri: str) -> bool:
    parsed = urlparse(uri)
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


@lru_cache(maxsize=1)
def _tracing_postgres_reachable() -> bool:
    return bool(env.postgres.uri_tracing) and _reachable(env.postgres.uri_tracing)


@lru_cache(maxsize=1)
def _durable_redis_reachable() -> bool:
    return bool(env.redis.uri_durable) and _reachable(env.redis.uri_durable)


@pytest.fixture(autouse=True)
def _skip_when_deps_unreachable(request):
    if not request.node.get_closest_marker("integration"):
        return
    if not _tracing_postgres_reachable():
        pytest.skip(
            "Tracing Postgres not reachable — skipping measurements integration tests"
        )
    if not _durable_redis_reachable():
        pytest.skip(
            "Durable Redis not reachable — skipping measurements integration tests"
        )


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
