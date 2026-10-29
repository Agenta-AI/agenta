import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

from oss.src.utils.env import env
from oss.tests.pytest.utils.postgres import require_core_uri


@pytest.fixture(autouse=True)
def _require_db_adjacent_acceptance_database(request):
    # Acceptance cases marked `integration` read the deployment's Postgres directly. An
    # unreachable database fails them, unless the environment declared it has no route to
    # it (AGENTA_TEST_NO_DATABASE, set by the Railway job), in which case they skip with
    # that reason.
    if request.node.get_closest_marker("integration"):
        require_core_uri()


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
