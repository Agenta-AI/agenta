"""Pool sizing for the two Postgres engines.

The sizing these tests pin is what keeps a worker from holding a hundred idle
connections on a 400-connection server.
"""

import os

import pytest

from oss.src.dbs.postgres.shared import engine as engine_module
from oss.src.dbs.postgres.shared.engine import (
    ENGINES_PER_PROCESS,
    PROFILE_API,
    PROFILE_WORKER,
    PoolSizing,
    pool_budget_warning,
    resolve_pool_sizing,
    set_pool_profile,
)
from oss.src.utils.env import env


# The shipped defaults, restated so an ambient POSTGRES_POOL_SIZE in the shell or
# the dev container cannot change what these tests assert.
DEFAULT_POOL_SIZE = 5
DEFAULT_MAX_OVERFLOW = 10
DEFAULT_WORKER_POOL_SIZE = 2
DEFAULT_WORKER_MAX_OVERFLOW = 8


SIZES = dict(
    pool_size=DEFAULT_POOL_SIZE,
    max_overflow=DEFAULT_MAX_OVERFLOW,
    worker_pool_size=DEFAULT_WORKER_POOL_SIZE,
    worker_max_overflow=DEFAULT_WORKER_MAX_OVERFLOW,
    pool_recycle=1800,
    pool_timeout=30,
)

POOL_ENV_VARS = (
    "POSTGRES_POOL_SIZE",
    "POSTGRES_MAX_OVERFLOW",
    "POSTGRES_WORKER_POOL_SIZE",
    "POSTGRES_WORKER_MAX_OVERFLOW",
    "POSTGRES_POOL_RECYCLE_SECONDS",
    "POSTGRES_POOL_TIMEOUT_SECONDS",
)


def test_api_profile_uses_the_api_pool():
    sizing = resolve_pool_sizing(profile=PROFILE_API, **SIZES)

    assert sizing == PoolSizing(
        pool_size=5,
        max_overflow=10,
        pool_recycle=1800,
        pool_timeout=30,
    )


def test_worker_profile_uses_the_narrower_worker_pool():
    sizing = resolve_pool_sizing(profile=PROFILE_WORKER, **SIZES)

    assert sizing.pool_size == 2
    assert sizing.max_overflow == 8
    # The recycle and timeout are not per-profile.
    assert sizing.pool_recycle == 1800
    assert sizing.pool_timeout == 30


def test_an_unknown_profile_falls_back_to_the_api_pool():
    sizing = resolve_pool_sizing(profile="cron", **SIZES)

    assert sizing.pool_size == 5
    assert sizing.max_overflow == 10


def test_pool_size_zero_is_raised_to_one():
    # SQLAlchemy reads pool_size=0 as an unbounded pool, which is the failure
    # this sizing exists to prevent.
    sizing = resolve_pool_sizing(
        profile=PROFILE_API, **{**SIZES, "pool_size": 0, "max_overflow": 0}
    )

    assert sizing.pool_size == 1
    assert sizing.max_overflow == 0


def test_a_negative_overflow_is_clamped_to_zero():
    sizing = resolve_pool_sizing(profile=PROFILE_API, **{**SIZES, "max_overflow": -5})

    assert sizing.max_overflow == 0


def test_peak_connections_counts_the_pool_plus_its_overflow():
    assert resolve_pool_sizing(profile=PROFILE_API, **SIZES).peak_connections == 15
    assert resolve_pool_sizing(profile=PROFILE_WORKER, **SIZES).peak_connections == 10


@pytest.mark.parametrize("profile", [PROFILE_API, PROFILE_WORKER])
def test_the_defaults_fit_a_400_connection_server_shared_by_ten_processes(profile):
    sizing = resolve_pool_sizing(
        profile=profile,
        pool_size=DEFAULT_POOL_SIZE,
        max_overflow=DEFAULT_MAX_OVERFLOW,
        worker_pool_size=DEFAULT_WORKER_POOL_SIZE,
        worker_max_overflow=DEFAULT_WORKER_MAX_OVERFLOW,
        pool_recycle=1800,
        pool_timeout=30,
    )

    assert (
        pool_budget_warning(
            sizing=sizing,
            max_connections=400,
            consumers=10,
        )
        is None
    )


@pytest.mark.skipif(
    any(os.getenv(name) for name in POOL_ENV_VARS),
    reason="a pool variable is set in this environment, so env.postgres is not the default",
)
def test_the_shipped_defaults_are_the_ones_the_budget_was_checked_against():
    assert env.postgres.pool_size == DEFAULT_POOL_SIZE
    assert env.postgres.max_overflow == DEFAULT_MAX_OVERFLOW
    assert env.postgres.worker_pool_size == DEFAULT_WORKER_POOL_SIZE
    assert env.postgres.worker_max_overflow == DEFAULT_WORKER_MAX_OVERFLOW
    assert env.postgres.pool_recycle_seconds == 30 * 60
    assert env.postgres.pool_timeout_seconds == 30


def test_the_old_constants_would_have_been_reported_as_oversized():
    # pool 102 + overflow 308 across 8 consumers: what the removed constants
    # produced, and what filled the production instance.
    warning = pool_budget_warning(
        sizing=PoolSizing(
            pool_size=102,
            max_overflow=308,
            pool_recycle=1800,
            pool_timeout=30,
        ),
        max_connections=400,
        consumers=8,
    )

    assert warning is not None
    assert "max_connections=400" in warning


def test_a_pool_that_exactly_fills_the_server_is_not_reported():
    warning = pool_budget_warning(
        sizing=PoolSizing(
            pool_size=5,
            max_overflow=15,
            pool_recycle=1800,
            pool_timeout=30,
        ),
        max_connections=400,
        consumers=10,
    )

    assert ENGINES_PER_PROCESS == 2
    assert warning is None


def test_setting_the_profile_after_an_engine_exists_is_refused(monkeypatch):
    # The guard turns an import-order regression into a boot failure instead of
    # a worker that silently keeps the wide api pool.
    monkeypatch.setattr(engine_module, "_transactions_engine", object())

    with pytest.raises(RuntimeError, match="after an engine was built"):
        set_pool_profile(PROFILE_WORKER)


def test_setting_the_profile_changes_what_a_new_engine_would_get(monkeypatch):
    monkeypatch.setattr(engine_module, "_transactions_engine", None)
    monkeypatch.setattr(engine_module, "_analytics_engine", None)
    monkeypatch.setattr(engine_module, "_profile", PROFILE_API)
    monkeypatch.setattr(env.postgres, "pool_size", 7)
    monkeypatch.setattr(env.postgres, "worker_pool_size", 3)

    assert engine_module.current_pool_sizing().pool_size == 7

    set_pool_profile(PROFILE_WORKER)

    assert engine_module.current_pool_sizing().pool_size == 3
