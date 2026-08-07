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


@lru_cache(maxsize=1)
def _store_reachable() -> bool:
    """TCP-probe the configured object store once per session.

    Same reasoning as Postgres above, one step further out: attachment teardown
    reads the store directly to prove the object is really gone. The bundled
    SeaweedFS publishes no host port at all (compose exposes 8333 only on its own
    network), so unlike Postgres this cannot be reached by pointing at localhost.
    """
    parsed = urlparse(env.store.endpoint_url or "")
    host = parsed.hostname
    if not host:
        return False
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


@pytest.fixture(autouse=True)
def _skip_store_adjacent_when_store_unreachable(request):
    if request.node.get_closest_marker("store_required") and not _store_reachable():
        pytest.skip("Object store not reachable — skipping store-adjacent tests")
