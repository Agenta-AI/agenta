import os
import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

import oss.src.dbs.redis.shared.engine as redis_engine_module
from oss.src.utils.env import env

# No disposable-database guard here, unlike `../wallets/conftest.py`: nothing in this
# package moves an alembic chain. These tests append measurement rows to an already
# migrated tracing database under ids they mint themselves, so there is no downgrade that
# could drop a table and take somebody's rows with it. They do leave their rows behind,
# which is additive and harmless — worth knowing when reading the table by hand.
#
# See the same block in `../wallets/conftest.py`: a skipped integration suite exits 0 and
# reports green, so where the infrastructure is supposed to exist an unreachable
# dependency must fail rather than skip. Off by default; CI sets it.
REQUIRE_INFRA_ENV_VAR = "AGENTA_TESTS_REQUIRE_INFRA"

_TRUTHY = {"1", "true", "t", "yes", "y", "on"}


def _infra_is_required() -> bool:
    return (os.getenv(REQUIRE_INFRA_ENV_VAR) or "").strip().lower() in _TRUTHY


# Fallbacks for a URI that omits the host or the port, per dependency. A single shared
# default is what made the Redis probe dial 5432: the reachability check and the message
# that names the address now both go through `_endpoint_of`, so they cannot disagree
# about what was tested, and neither can inherit Postgres's port for a Redis URI.
TRACING_POSTGRES_DEFAULTS = ("postgres", 5432)
DURABLE_REDIS_DEFAULTS = ("localhost", 6379)


def _endpoint_of(uri: str | None, defaults: tuple[str, int]) -> tuple[str, int]:
    default_host, default_port = defaults
    parsed = urlparse(uri or "")
    return parsed.hostname or default_host, parsed.port or default_port


def _address_of(uri: str | None, defaults: tuple[str, int]) -> str:
    """Host:port only — the configured URI carries a password."""
    if not uri:
        return "<unset>"
    host, port = _endpoint_of(uri, defaults)
    return f"{host}:{port}"


def _skip_or_fail(*, dependency: str, address: str) -> None:
    reason = f"{dependency} not reachable at {address}"
    if _infra_is_required():
        pytest.fail(
            f"{reason}; {REQUIRE_INFRA_ENV_VAR} is set, so this is a failure rather than"
            " a skip. Check the service container and the POSTGRES_URI_CORE /"
            " POSTGRES_URI_TRACING / REDIS_URI values pointing at it.",
            pytrace=False,
        )
    pytest.skip(f"{reason} — skipping measurements integration tests")


def _reachable(uri: str, defaults: tuple[str, int]) -> bool:
    try:
        with socket.create_connection(_endpoint_of(uri, defaults), timeout=0.5):
            return True
    except OSError:
        return False


@lru_cache(maxsize=1)
def _tracing_postgres_reachable() -> bool:
    return bool(env.postgres.uri_tracing) and _reachable(
        env.postgres.uri_tracing, TRACING_POSTGRES_DEFAULTS
    )


@lru_cache(maxsize=1)
def _durable_redis_reachable() -> bool:
    return bool(env.redis.uri_durable) and _reachable(
        env.redis.uri_durable, DURABLE_REDIS_DEFAULTS
    )


@pytest.fixture(autouse=True)
def _skip_when_deps_unreachable(request):
    if not request.node.get_closest_marker("integration"):
        return
    if not _tracing_postgres_reachable():
        _skip_or_fail(
            dependency="Tracing Postgres",
            address=_address_of(env.postgres.uri_tracing, TRACING_POSTGRES_DEFAULTS),
        )
    if not _durable_redis_reachable():
        _skip_or_fail(
            dependency="Durable Redis",
            address=_address_of(env.redis.uri_durable, DURABLE_REDIS_DEFAULTS),
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
