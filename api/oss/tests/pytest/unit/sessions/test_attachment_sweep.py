import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from oss.src.core.sessions.attachments.dtos import Attachment, AttachmentState
from oss.src.tasks.asyncio.sessions import attachment_sweep


class _FakeLockEngine:
    def __init__(self, *, held=False, lose_on_renew=False):
        self.value = b"held" if held else None
        self.lose_on_renew = lose_on_renew
        self.renew_calls = 0
        self.lease_ttls = []

    async def set(self, _key, value, *, nx, ex):
        self.lease_ttls.append(ex)
        if nx and self.value is not None:
            return None
        self.value = value
        return True

    async def eval(self, _script, _count, _key, owner, ttl=None):
        if ttl is not None:
            self.renew_calls += 1
            self.lease_ttls.append(ttl)
            if self.lose_on_renew:
                self.value = b"other-owner"
                return 0
            return int(self.value == owner)
        if self.value != owner:
            return 0
        self.value = None
        return 1


class _FakeOriginalStore:
    def __init__(self, *, failing_ids=None):
        self.deleted = []
        self.failing_ids = set(failing_ids or [])

    async def delete_attachment_original(self, *, project_id, mount_id, path):
        attachment_id = path.split("/", 1)[0]
        self.deleted.append(attachment_id)
        if attachment_id in self.failing_ids:
            raise RuntimeError("object store unavailable")


class _FakeAttachmentsDAO:
    def __init__(self, rows, *, claim_before_delete=None):
        self.rows = list(rows)
        self.claim_before_delete = claim_before_delete
        self.reap_calls = 0
        self.sweep_calls = 0
        self.claim_succeeded = None

    async def _delete_candidates(self, *, candidates, delete_original):
        for row in candidates:
            row.state = AttachmentState.DELETING

        deleted = []
        for row in candidates:
            if row.id == self.claim_before_delete:
                self.claim_succeeded = row.state == AttachmentState.READY
            try:
                await delete_original(row)
            except Exception:
                continue
            self.rows.remove(row)
            deleted.append(row)
        return deleted

    async def reap_stale_pending(
        self,
        *,
        older_than,
        delete_original,
        limit=100,
    ):
        self.reap_calls += 1
        candidates = [
            row
            for row in self.rows
            if row.state in {AttachmentState.PENDING, AttachmentState.DELETING}
            and row.created_at < older_than
        ][:limit]
        return await self._delete_candidates(
            candidates=candidates,
            delete_original=delete_original,
        )

    async def sweep_unreferenced_ready(
        self,
        *,
        older_than,
        delete_original,
        limit=100,
    ):
        self.sweep_calls += 1
        candidates = [
            row
            for row in self.rows
            if row.state == AttachmentState.READY
            and row.referenced_at is None
            and row.created_at < older_than
        ][:limit]
        return await self._delete_candidates(
            candidates=candidates,
            delete_original=delete_original,
        )


def _attachment(
    *,
    state: AttachmentState,
    age: timedelta,
    referenced: bool = False,
) -> Attachment:
    attachment_id = uuid4()
    timestamp = datetime.now(timezone.utc) - age
    return Attachment(
        id=attachment_id,
        project_id=uuid4(),
        session_id="session-1",
        mount_id=uuid4(),
        path=f"{attachment_id}/file.bin",
        filename="file.bin",
        media_type="application/zip",
        size=10,
        kind="other",
        state=state,
        idempotency_key=uuid4().hex,
        content_digest=uuid4().hex,
        referenced_at=timestamp if referenced else None,
        created_at=timestamp,
    )


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def _run(dao, store, lock=None, *, sweep_interval_seconds=60):
    await attachment_sweep.run_attachment_sweep(
        attachments_dao=dao,
        original_store=store,
        lock_engine=lock or _FakeLockEngine(),
        pending_ttl_seconds=900,
        unreferenced_ttl_seconds=86_400,
        sweep_interval_seconds=sweep_interval_seconds,
    )


@pytest.mark.anyio
async def test_sweep_removes_only_stale_unclaimed_rows(anyio_backend):
    assert anyio_backend == "asyncio"
    stale_pending = _attachment(state=AttachmentState.PENDING, age=timedelta(hours=1))
    stale_ready = _attachment(state=AttachmentState.READY, age=timedelta(days=2))
    claimed_ready = _attachment(
        state=AttachmentState.READY,
        age=timedelta(days=2),
        referenced=True,
    )
    fresh_ready = _attachment(state=AttachmentState.READY, age=timedelta(hours=1))
    dao = _FakeAttachmentsDAO([stale_pending, stale_ready, claimed_ready, fresh_ready])
    store = _FakeOriginalStore()

    await _run(dao, store)

    assert {row.id for row in dao.rows} == {claimed_ready.id, fresh_ready.id}
    assert set(store.deleted) == {str(stale_pending.id), str(stale_ready.id)}


@pytest.mark.anyio
async def test_claim_after_tombstone_cannot_reference_deleted_object(anyio_backend):
    assert anyio_backend == "asyncio"
    ready = _attachment(state=AttachmentState.READY, age=timedelta(days=2))
    dao = _FakeAttachmentsDAO([ready], claim_before_delete=ready.id)
    store = _FakeOriginalStore()

    await _run(dao, store)

    assert dao.rows == []
    assert dao.claim_succeeded is False
    assert store.deleted == [str(ready.id)]


@pytest.mark.anyio
async def test_object_delete_failure_keeps_row_for_later_retry(anyio_backend):
    assert anyio_backend == "asyncio"
    pending = _attachment(state=AttachmentState.PENDING, age=timedelta(hours=1))
    dao = _FakeAttachmentsDAO([pending])
    store = _FakeOriginalStore(failing_ids={str(pending.id)})

    await _run(dao, store)

    assert dao.rows == [pending]
    assert pending.state == AttachmentState.DELETING
    assert store.deleted == [str(pending.id)]

    store.failing_ids.clear()
    await _run(dao, store)

    assert dao.rows == []
    assert store.deleted == [str(pending.id), str(pending.id)]


@pytest.mark.anyio
async def test_sweep_drains_more_than_one_batch_and_renews_lock(anyio_backend):
    assert anyio_backend == "asyncio"
    rows = [
        _attachment(state=AttachmentState.READY, age=timedelta(days=2))
        for _ in range(101)
    ]
    dao = _FakeAttachmentsDAO(rows)
    store = _FakeOriginalStore()
    lock = _FakeLockEngine()

    await _run(dao, store, lock)

    assert dao.rows == []
    assert dao.sweep_calls == 2
    assert lock.renew_calls == 1
    assert lock.lease_ttls == [300, 300]
    assert len(store.deleted) == 101


@pytest.mark.anyio
async def test_sweep_lease_scales_with_configured_interval(anyio_backend):
    assert anyio_backend == "asyncio"
    lock = _FakeLockEngine()

    await _run(
        _FakeAttachmentsDAO([]),
        _FakeOriginalStore(),
        lock,
        sweep_interval_seconds=200,
    )

    assert lock.lease_ttls == [400]


@pytest.mark.anyio
async def test_lost_lock_stops_backlog_drain(anyio_backend):
    assert anyio_backend == "asyncio"
    rows = [
        _attachment(state=AttachmentState.READY, age=timedelta(days=2))
        for _ in range(101)
    ]
    dao = _FakeAttachmentsDAO(rows)
    lock = _FakeLockEngine(lose_on_renew=True)

    await _run(dao, _FakeOriginalStore(), lock)

    assert len(dao.rows) == 1
    assert dao.sweep_calls == 1
    assert lock.renew_calls == 1


@pytest.mark.anyio
async def test_held_distributed_lock_skips_pass(anyio_backend):
    assert anyio_backend == "asyncio"
    dao = _FakeAttachmentsDAO(
        [_attachment(state=AttachmentState.READY, age=timedelta(days=2))]
    )

    await _run(dao, _FakeOriginalStore(), _FakeLockEngine(held=True))

    assert dao.reap_calls == 0
    assert dao.sweep_calls == 0


@pytest.mark.anyio
async def test_loop_sleeps_at_configured_cadence_and_cancels(
    anyio_backend,
    monkeypatch,
):
    assert anyio_backend == "asyncio"
    passes = 0
    sleeps = []

    async def fake_pass(**_kwargs):
        nonlocal passes
        passes += 1

    async def cancel_on_sleep(seconds):
        sleeps.append(seconds)
        raise asyncio.CancelledError

    monkeypatch.setattr(attachment_sweep, "run_attachment_sweep", fake_pass)
    monkeypatch.setattr(attachment_sweep.asyncio, "sleep", cancel_on_sleep)

    with pytest.raises(asyncio.CancelledError):
        await attachment_sweep.attachment_sweep_loop(
            attachments_dao=_FakeAttachmentsDAO([]),
            original_store=_FakeOriginalStore(),
            lock_engine=_FakeLockEngine(),
            pending_ttl_seconds=900,
            unreferenced_ttl_seconds=86_400,
            sweep_interval_seconds=17,
        )

    assert passes == 1
    assert sleeps == [17]


class _RecordingLog:
    def __init__(self):
        self.warnings = []
        self.errors = []

    def warning(self, message, *args, **_kwargs):
        self.warnings.append(message % args)

    def error(self, message, *args, **kwargs):
        self.errors.append((message % args, kwargs.get("exc_info")))


async def _run_loop_until_sleeps(monkeypatch, *, outcomes, sleeps_before_cancel):
    log = _RecordingLog()
    sleeps = []
    remaining = list(outcomes)

    async def fake_pass(**_kwargs):
        outcome = remaining.pop(0)
        if outcome is not None:
            raise outcome

    async def record_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == sleeps_before_cancel:
            raise asyncio.CancelledError

    monkeypatch.setattr(attachment_sweep, "log", log)
    monkeypatch.setattr(attachment_sweep, "run_attachment_sweep", fake_pass)
    monkeypatch.setattr(attachment_sweep.asyncio, "sleep", record_sleep)

    with pytest.raises(asyncio.CancelledError):
        await attachment_sweep.attachment_sweep_loop(
            attachments_dao=_FakeAttachmentsDAO([]),
            original_store=_FakeOriginalStore(),
            lock_engine=_FakeLockEngine(),
            pending_ttl_seconds=900,
            unreferenced_ttl_seconds=86_400,
            sweep_interval_seconds=3_600,
        )
    return log, sleeps


@pytest.mark.anyio
async def test_transient_redis_failure_warns_and_retries_soon(
    anyio_backend,
    monkeypatch,
):
    assert anyio_backend == "asyncio"
    log, sleeps = await _run_loop_until_sleeps(
        monkeypatch,
        outcomes=[
            attachment_sweep.RedisTimeoutError("Timeout connecting to server"),
            attachment_sweep.RedisConnectionError("Connection refused"),
            None,
        ],
        sleeps_before_cancel=3,
    )

    assert sleeps == [5, 10, 3_600]
    assert len(log.warnings) == 2
    assert log.errors == []


@pytest.mark.anyio
async def test_redis_down_for_repeated_passes_escalates_to_error(
    anyio_backend,
    monkeypatch,
):
    assert anyio_backend == "asyncio"
    log, sleeps = await _run_loop_until_sleeps(
        monkeypatch,
        outcomes=[attachment_sweep.RedisTimeoutError("timeout")] * 6,
        sleeps_before_cancel=6,
    )

    assert sleeps == [5, 10, 20, 40, 60, 60]
    assert len(log.warnings) == 2
    assert len(log.errors) == 4
    assert all(exc_info for _, exc_info in log.errors)


@pytest.mark.anyio
async def test_redis_failure_count_resets_after_a_good_pass(
    anyio_backend,
    monkeypatch,
):
    assert anyio_backend == "asyncio"
    timeout = attachment_sweep.RedisTimeoutError("timeout")
    log, sleeps = await _run_loop_until_sleeps(
        monkeypatch,
        outcomes=[timeout, timeout, None, timeout],
        sleeps_before_cancel=4,
    )

    assert sleeps == [5, 10, 3_600, 5]
    assert len(log.warnings) == 3
    assert log.errors == []


@pytest.mark.anyio
async def test_other_errors_still_log_error_and_wait_the_interval(
    anyio_backend,
    monkeypatch,
):
    assert anyio_backend == "asyncio"
    log, sleeps = await _run_loop_until_sleeps(
        monkeypatch,
        outcomes=[RuntimeError("database down")],
        sleeps_before_cancel=1,
    )

    assert sleeps == [3_600]
    assert log.warnings == []
    assert len(log.errors) == 1
