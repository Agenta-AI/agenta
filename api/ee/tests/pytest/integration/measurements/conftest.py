import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

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
