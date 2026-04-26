"""
Unit tests for evaluation runtime lock helpers.

These tests use a real in-memory fakeredis instance so they run without an
external Redis process. Install `fakeredis` in the test environment to enable
them.

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
from contextlib import ExitStack
import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# Fake Redis fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def fake_redis():
    """Return a fakeredis async client and patch it into the caching lock client."""
    fakeredis = pytest.importorskip("fakeredis")
    aioredis = pytest.importorskip("fakeredis.aioredis")
    from oss.src.utils import caching

    server = fakeredis.FakeServer()
    client = aioredis.FakeRedis(server=server, decode_responses=False)

    async def _renew_lock_for_tests(
        *,
        namespace: str,
        key=None,
        project_id=None,
        user_id=None,
        ttl: int = caching.AGENTA_LOCK_TTL,
        owner=None,
    ) -> bool:
        lock_key = caching.pack(
            namespace=f"lock:{namespace}",
            key=key,
            project_id=project_id,
            user_id=user_id,
        )
        raw = await client.get(lock_key)
        if raw is None:
            return False
        if owner is not None and raw != owner.encode():
            return False
        return bool(await client.expire(lock_key, ttl))

    async def _release_lock_for_tests(
        *,
        namespace: str,
        key=None,
        project_id=None,
        user_id=None,
        owner=None,
        strict: bool = False,
    ) -> bool:
        lock_key = caching.pack(
            namespace=f"lock:{namespace}",
            key=key,
            project_id=project_id,
            user_id=user_id,
        )
        raw = await client.get(lock_key)
        if raw is None:
            return False
        if owner is not None and raw != owner.encode():
            return False
        return bool(await client.delete(lock_key))

    cache_engine = pytest.importorskip("oss.src.dbs.redis.shared.engine")

    with (
        patch.object(cache_engine._cache_engine, "get_r_lock", return_value=client),
        patch(
            "oss.src.utils.caching.renew_lock",
            _renew_lock_for_tests,
        ),
        patch(
            "oss.src.utils.caching.release_lock",
            _release_lock_for_tests,
        ),
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


def _genson_patch():
    module = types.ModuleType("genson")
    query_module = types.ModuleType("oss.src.core.evaluations.tasks.query")

    class SchemaBuilder: ...

    async def process_query_source_run(*args, **kwargs):
        return None

    module.SchemaBuilder = SchemaBuilder
    query_module.process_query_source_run = process_query_source_run
    stack = ExitStack()
    stack.enter_context(
        patch.dict(
            sys.modules,
            {
                "genson": module,
                "oss.src.core.evaluations.tasks.query": query_module,
            },
        )
    )

    try:
        import agenta.sdk.models.workflows as workflow_models

        if not hasattr(workflow_models, "WorkflowServiceInterface"):
            stack.enter_context(
                patch.object(
                    workflow_models,
                    "WorkflowServiceInterface",
                    object,
                    create=True,
                )
            )
        if not hasattr(workflow_models, "WorkflowServiceConfiguration"):
            stack.enter_context(
                patch.object(
                    workflow_models,
                    "WorkflowServiceConfiguration",
                    object,
                    create=True,
                )
            )
    except ImportError:
        pass

    return stack


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


@pytest.mark.asyncio
async def test_acquire_job_lock_returns_none_when_singleton_slot_is_held(fake_redis):
    from oss.src.core.evaluations.runtime.locks import acquire_job_lock

    run_id = _run_id()

    first = await acquire_job_lock(
        run_id=run_id,
        job_id=_job_id(),
        lock_id="singleton",
    )
    assert first is not None

    second = await acquire_job_lock(
        run_id=run_id,
        job_id=_job_id(),
        lock_id="singleton",
    )
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

    with _genson_patch():
        from oss.src.tasks.taskiq.evaluations.worker import EvaluationsWorker

    run_id = uuid4()

    async def _failing_coro():
        raise RuntimeError("task failed")

    with pytest.raises(RuntimeError, match="task failed"):
        await EvaluationsWorker._with_job_lock(
            run_id,
            job_id=_job_id(),
            job_type="api",
            allow_concurrency=False,
            runner=_failing_coro,
        )

    assert await is_run_executing(run_id=str(run_id)) is False


@pytest.mark.asyncio
async def test_refresh_worker_heartbeat_preserves_created_at_without_fakeredis():
    import oss.src.core.evaluations.runtime.locks as locks

    class DummyRedis:
        def __init__(self):
            self.values = {}

        async def get(self, key):
            return self.values.get(key)

        async def set(self, key, value, ex=None):
            self.values[key] = value
            return True

    dummy = DummyRedis()
    cache_engine = pytest.importorskip("oss.src.dbs.redis.shared.engine")

    with (
        patch.object(cache_engine._cache_engine, "get_r_lock", return_value=dummy),
        patch(
            "oss.src.core.evaluations.runtime.locks._now_iso",
            side_effect=["2026-03-25T10:00:00Z", "2026-03-25T10:01:00Z"],
        ),
    ):
        first = await locks.refresh_worker_heartbeat(worker_id="worker-1")
        second = await locks.refresh_worker_heartbeat(worker_id="worker-1")

    assert first.created_at == "2026-03-25T10:00:00Z"
    assert first.updated_at == "2026-03-25T10:00:00Z"
    assert second.created_at == "2026-03-25T10:00:00Z"
    assert second.updated_at == "2026-03-25T10:01:00Z"


@pytest.mark.asyncio
async def test_run_job_heartbeat_fails_after_missing_renew_deadline():
    import oss.src.core.evaluations.runtime.locks as locks

    clock = {"now": 0.0}

    async def _fake_sleep(seconds):
        clock["now"] += seconds

    async def _failing_renew(**kwargs):
        raise RuntimeError("redis unavailable")

    def _fake_monotonic():
        return clock["now"]

    with (
        patch("oss.src.core.evaluations.runtime.locks.sleep", _fake_sleep),
        patch("oss.src.core.evaluations.runtime.locks.monotonic", _fake_monotonic),
        patch(
            "oss.src.core.evaluations.runtime.locks.renew_job_lock",
            _failing_renew,
        ),
    ):
        with pytest.raises(
            locks.JobLockLeaseLostError,
            match="heartbeat renew deadline exceeded",
        ):
            await locks.run_job_heartbeat(
                run_id="run-1",
                job_id="job-1",
                job_token="token-1",
                interval=30,
                ttl=300,
                safety_margin=60,
            )

    assert clock["now"] == 240.0


@pytest.mark.asyncio
async def test_with_job_lock_cancels_runner_when_heartbeat_fails():
    from oss.src.core.evaluations.runtime.locks import JobLockLeaseLostError

    with _genson_patch():
        import oss.src.tasks.taskiq.evaluations.worker as worker_module

    EvaluationsWorker = worker_module.EvaluationsWorker

    runner_cancelled = asyncio.Event()

    async def _runner():
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            runner_cancelled.set()
            raise

    async def _heartbeat(**kwargs):
        await asyncio.sleep(0)
        raise JobLockLeaseLostError(
            run_id=str(run_id),
            job_id=job_id,
            lock_id="singleton",
            reason="heartbeat renew deadline exceeded",
        )

    run_id = uuid4()
    job_id = _job_id()

    with (
        patch.object(
            worker_module,
            "has_mutation_lock",
            AsyncMock(return_value=False),
        ),
        patch.object(
            worker_module,
            "acquire_job_lock",
            AsyncMock(return_value=SimpleNamespace(job_token="token-1")),
        ),
        patch.object(
            worker_module,
            "release_job_lock",
            AsyncMock(return_value=True),
        ) as release_mock,
        patch.object(
            worker_module,
            "run_job_heartbeat",
            _heartbeat,
        ),
    ):
        with pytest.raises(JobLockLeaseLostError):
            await EvaluationsWorker._with_job_lock(
                run_id,
                job_id=job_id,
                job_type="api",
                allow_concurrency=False,
                runner=_runner,
            )

    assert runner_cancelled.is_set()
    release_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_with_job_lock_raises_specific_skip_error_when_lock_not_acquired():
    with _genson_patch():
        import oss.src.tasks.taskiq.evaluations.worker as worker_module

    EvaluationsWorker = worker_module.EvaluationsWorker

    run_id = uuid4()
    job_id = _job_id()

    with (
        patch.object(
            worker_module,
            "has_mutation_lock",
            AsyncMock(return_value=False),
        ),
        patch.object(
            worker_module,
            "acquire_job_lock",
            AsyncMock(return_value=None),
        ),
    ):
        with pytest.raises(worker_module.JobLockSkippedError) as exc_info:
            await EvaluationsWorker._with_job_lock(
                run_id,
                job_id=job_id,
                job_type="api",
                allow_concurrency=False,
                runner=AsyncMock(),
            )

    assert exc_info.value.run_id == str(run_id)
    assert exc_info.value.job_id == job_id
    assert exc_info.value.lock_id == "singleton"
