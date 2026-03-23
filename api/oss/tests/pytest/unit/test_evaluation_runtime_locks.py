"""
Unit tests for evaluation runtime lock helpers.

These tests use a real in-memory fakeredis instance so they run without an
external Redis process.  Install `fakeredis[aioredis]` (or `fakeredis`) in the
test environment to enable them.

Tests cover:
    - acquire_job_lock / acquire_mutation_lock
    - renew with correct and wrong token
    - release with correct and wrong token
    - list_active_job_locks / is_run_executing
    - get_mutation_lock / has_mutation_lock
    - heartbeat expiration (TTL=1 s test)
    - task wrapper releases lock on exception
"""

import asyncio
from unittest.mock import patch
from uuid import uuid4

import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# Fake Redis fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def fake_redis():
    """Return a fakeredis async client and patch it into the locks module."""
    fakeredis = pytest.importorskip("fakeredis")
    aioredis = pytest.importorskip("fakeredis.aioredis")

    server = fakeredis.FakeServer()
    client = aioredis.FakeRedis(server=server, decode_responses=False)

    with patch(
        "oss.src.core.evaluations.runtime.locks._get_redis",
        return_value=client,
    ):
        yield client

    await client.aclose()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run_id() -> str:
    return str(uuid4())


def _job_id() -> str:
    return str(uuid4())


# ---------------------------------------------------------------------------
# acquire_job_lock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_acquire_job_lock_succeeds(fake_redis):
    from oss.src.core.evaluations.runtime.locks import acquire_job_lock

    run_id = _run_id()
    job_id = _job_id()

    payload = await acquire_job_lock(run_id=run_id, job_id=job_id)

    assert payload is not None
    assert payload.job_id == job_id
    assert payload.job_type == "api"
    assert len(payload.job_token) > 0


@pytest.mark.asyncio
async def test_acquire_job_lock_returns_none_when_held(fake_redis):
    from oss.src.core.evaluations.runtime.locks import acquire_job_lock

    run_id = _run_id()
    job_id = _job_id()

    first = await acquire_job_lock(run_id=run_id, job_id=job_id)
    assert first is not None

    second = await acquire_job_lock(run_id=run_id, job_id=job_id)
    assert second is None


# ---------------------------------------------------------------------------
# acquire_mutation_lock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_acquire_mutation_lock_succeeds(fake_redis):
    from oss.src.core.evaluations.runtime.locks import acquire_mutation_lock

    run_id = _run_id()
    job_id = _job_id()

    payload = await acquire_mutation_lock(run_id=run_id, job_id=job_id, job_type="web")

    assert payload is not None
    assert payload.job_type == "web"


@pytest.mark.asyncio
async def test_acquire_mutation_lock_returns_none_when_held(fake_redis):
    from oss.src.core.evaluations.runtime.locks import acquire_mutation_lock

    run_id = _run_id()

    first = await acquire_mutation_lock(run_id=run_id, job_id=_job_id())
    assert first is not None

    second = await acquire_mutation_lock(run_id=run_id, job_id=_job_id())
    assert second is None


# ---------------------------------------------------------------------------
# renew_job_lock — correct token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_renew_job_lock_with_correct_token(fake_redis):
    from oss.src.core.evaluations.runtime.locks import acquire_job_lock, renew_job_lock

    run_id = _run_id()
    job_id = _job_id()

    payload = await acquire_job_lock(run_id=run_id, job_id=job_id)
    assert payload is not None

    ok = await renew_job_lock(
        run_id=run_id,
        job_id=job_id,
        job_token=payload.job_token,
    )
    assert ok is True


# ---------------------------------------------------------------------------
# renew_job_lock — wrong token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_renew_job_lock_with_wrong_token(fake_redis):
    from oss.src.core.evaluations.runtime.locks import acquire_job_lock, renew_job_lock

    run_id = _run_id()
    job_id = _job_id()

    await acquire_job_lock(run_id=run_id, job_id=job_id)

    ok = await renew_job_lock(
        run_id=run_id,
        job_id=job_id,
        job_token="wrong-token",
    )
    assert ok is False


# ---------------------------------------------------------------------------
# release_job_lock — correct token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_release_job_lock_with_correct_token(fake_redis):
    from oss.src.core.evaluations.runtime.locks import (
        acquire_job_lock,
        release_job_lock,
        is_run_executing,
    )

    run_id = _run_id()
    job_id = _job_id()

    payload = await acquire_job_lock(run_id=run_id, job_id=job_id)
    assert payload is not None

    assert await is_run_executing(run_id=run_id) is True

    ok = await release_job_lock(
        run_id=run_id,
        job_id=job_id,
        job_token=payload.job_token,
    )
    assert ok is True
    assert await is_run_executing(run_id=run_id) is False


# ---------------------------------------------------------------------------
# release_job_lock — wrong token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_release_job_lock_with_wrong_token(fake_redis):
    from oss.src.core.evaluations.runtime.locks import (
        acquire_job_lock,
        release_job_lock,
        is_run_executing,
    )

    run_id = _run_id()
    job_id = _job_id()

    await acquire_job_lock(run_id=run_id, job_id=job_id)

    ok = await release_job_lock(
        run_id=run_id,
        job_id=job_id,
        job_token="wrong-token",
    )
    assert ok is False
    # Lock must still be held
    assert await is_run_executing(run_id=run_id) is True


# ---------------------------------------------------------------------------
# list_active_job_locks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_active_job_locks_returns_all_jobs(fake_redis):
    from oss.src.core.evaluations.runtime.locks import (
        acquire_job_lock,
        list_active_job_locks,
    )

    run_id = _run_id()
    job_id_a = _job_id()
    job_id_b = _job_id()

    await acquire_job_lock(run_id=run_id, job_id=job_id_a)
    await acquire_job_lock(run_id=run_id, job_id=job_id_b)

    locks = await list_active_job_locks(run_id=run_id)
    assert len(locks) == 2
    found_ids = {lock.job_id for lock in locks}
    assert job_id_a in found_ids
    assert job_id_b in found_ids


# ---------------------------------------------------------------------------
# has_mutation_lock / get_mutation_lock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_has_mutation_lock_false_when_not_acquired(fake_redis):
    from oss.src.core.evaluations.runtime.locks import has_mutation_lock

    run_id = _run_id()
    assert await has_mutation_lock(run_id=run_id) is False


@pytest.mark.asyncio
async def test_has_mutation_lock_true_after_acquire(fake_redis):
    from oss.src.core.evaluations.runtime.locks import (
        acquire_mutation_lock,
        has_mutation_lock,
        get_mutation_lock,
    )

    run_id = _run_id()
    job_id = _job_id()

    payload = await acquire_mutation_lock(run_id=run_id, job_id=job_id, job_type="sdk")
    assert payload is not None
    assert await has_mutation_lock(run_id=run_id) is True

    stored = await get_mutation_lock(run_id=run_id)
    assert stored is not None
    assert stored.job_id == job_id
    assert stored.job_type == "sdk"


# ---------------------------------------------------------------------------
# Heartbeat expiration: lock disappears when TTL elapses
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_job_lock_expires_without_heartbeat(fake_redis):
    from oss.src.core.evaluations.runtime.locks import (
        acquire_job_lock,
        is_run_executing,
    )

    run_id = _run_id()
    job_id = _job_id()

    # Acquire with a very short TTL (1 second)
    payload = await acquire_job_lock(run_id=run_id, job_id=job_id, ttl=1)
    assert payload is not None
    assert await is_run_executing(run_id=run_id) is True

    # Wait for TTL to expire
    await asyncio.sleep(1.1)

    assert await is_run_executing(run_id=run_id) is False


# ---------------------------------------------------------------------------
# Task wrapper releases lock on exception
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_with_job_lock_releases_on_exception(fake_redis):
    """
    The _with_job_lock static method must release the job lock even when the
    wrapped coroutine raises an exception.
    """
    from oss.src.core.evaluations.runtime.locks import is_run_executing
    from oss.src.tasks.taskiq.evaluations.worker import EvaluationsWorker

    run_id = uuid4()

    async def _failing_coro():
        raise RuntimeError("task failed")

    with pytest.raises(RuntimeError, match="task failed"):
        await EvaluationsWorker._with_job_lock(run_id, "api", _failing_coro())

    assert await is_run_executing(run_id=str(run_id)) is False
