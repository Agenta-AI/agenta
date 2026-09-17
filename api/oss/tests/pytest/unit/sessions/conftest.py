"""Which database each case in this directory needs, and what it does when it is not there.

Two, not one. Most of the DAO cases here read the core database; the records cases read the
analytics engine, which is the **tracing** database, a different address configured
separately. Only core was probed, so a host with a reachable core and no tracing address ran
those cases and watched them fail with

    socket.gaierror: [Errno -3] Temporary failure in name resolution

which says nothing about the reason and reads as a defect in the code (D152). They skip now,
naming the address they wanted. The two files that need it say so by taking
`the_tracing_database`, rather than the whole directory demanding an address most of it
never reads.
"""

import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

from oss.src.utils.env import env


def _reachable(uri: str) -> bool:
    parsed = urlparse(uri)
    host = parsed.hostname or "postgres"
    port = parsed.port or 5432
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


@lru_cache(maxsize=1)
def _postgres_reachable() -> bool:
    """TCP-probe the configured core Postgres once per session.

    The integration DAO tests here need a real Postgres. The default URI points
    at the Docker-network host `postgres:5432`, which resolves in-compose/CI but
    not on a bare host (`load-env` leaves it commented). Probe rather than error
    so a native `py-run-tests --api` skips these instead of failing setup.
    """
    return _reachable(env.postgres.uri_core)


@lru_cache(maxsize=1)
def _tracing_reachable() -> bool:
    """The same probe for the tracing database, which the records cases read."""
    return _reachable(env.postgres.uri_tracing)


@pytest.fixture(autouse=True)
def _skip_when_postgres_unreachable(request):
    if request.node.get_closest_marker("integration") and not _postgres_reachable():
        pytest.skip("Postgres not reachable — skipping session DAO integration tests")


@pytest.fixture
def the_tracing_database():
    """For cases whose DAO is built on `get_analytics_engine()`, which reads the tracing URI.

    Named rather than inferred, because the address is configured on its own and a case that
    needs it can be sitting next to one that does not.
    """
    if not _tracing_reachable():
        pytest.skip(
            "the tracing database is not reachable — point POSTGRES_URI_TRACING at this "
            "deployment's tracing database to run the records DAO cases"
        )
