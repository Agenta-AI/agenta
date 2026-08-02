from contextlib import asynccontextmanager
from uuid import uuid4

import pytest

from oss.src.core.sessions.attachments.dtos import (
    AttachmentLimits,
    AttachmentQuotaUsage,
    AttachmentState,
)
from oss.src.core.sessions.attachments.types import (
    AttachmentQuotaExceeded,
    enforce_attachment_quota,
)
from oss.src.dbs.postgres.sessions.attachments.dao import SessionAttachmentsDAO
from oss.src.dbs.postgres.sessions.attachments.dbes import SessionAttachmentDBE


LIMITS = AttachmentLimits(
    max_per_session_count=100,
    max_per_session_bytes=1_000,
    max_pending_per_session=20,
)


def test_count_quota_rejects_at_capacity():
    with pytest.raises(AttachmentQuotaExceeded) as exc_info:
        enforce_attachment_quota(
            usage=AttachmentQuotaUsage(stored_count=100),
            limits=LIMITS,
            incoming_size=1,
        )

    assert exc_info.value.quota == "count"


def test_count_quota_admits_the_last_available_slot():
    enforce_attachment_quota(
        usage=AttachmentQuotaUsage(stored_count=99),
        limits=LIMITS,
        incoming_size=1,
    )


def test_byte_quota_rejects_when_upload_would_exceed_capacity():
    with pytest.raises(AttachmentQuotaExceeded) as exc_info:
        enforce_attachment_quota(
            usage=AttachmentQuotaUsage(stored_bytes=1_000),
            limits=LIMITS,
            incoming_size=1,
        )

    assert exc_info.value.quota == "bytes"


def test_byte_quota_admits_an_upload_that_exactly_fills_capacity():
    enforce_attachment_quota(
        usage=AttachmentQuotaUsage(stored_bytes=999),
        limits=LIMITS,
        incoming_size=1,
    )


def test_pending_quota_rejects_at_capacity():
    with pytest.raises(AttachmentQuotaExceeded) as exc_info:
        enforce_attachment_quota(
            usage=AttachmentQuotaUsage(pending_count=20),
            limits=LIMITS,
            incoming_size=1,
        )

    assert exc_info.value.quota == "pending"


def test_pending_quota_admits_the_last_available_slot():
    enforce_attachment_quota(
        usage=AttachmentQuotaUsage(pending_count=19),
        limits=LIMITS,
        incoming_size=1,
    )


def test_pending_rows_do_not_consume_stored_count_or_byte_quota():
    enforce_attachment_quota(
        usage=AttachmentQuotaUsage(
            stored_count=99,
            stored_bytes=999,
            pending_count=19,
        ),
        limits=LIMITS,
        incoming_size=1,
    )


class FakeAggregateResult:
    def __init__(self, row):
        self._row = row

    def one(self):
        return self._row

    def scalar_one(self):
        return self._row


class FakeQuotaSession:
    def __init__(self):
        self._rows = iter([(99, 999), 19])

    async def execute(self, _statement):
        return FakeAggregateResult(next(self._rows))


async def test_dao_usage_keeps_pending_separate_from_stored_quota():
    usage = await SessionAttachmentsDAO._get_quota_usage(
        session=FakeQuotaSession(),
        project_id=uuid4(),
        session_id="concurrent-session",
    )

    assert usage == AttachmentQuotaUsage(
        stored_count=99,
        stored_bytes=999,
        pending_count=19,
    )
    enforce_attachment_quota(usage=usage, limits=LIMITS, incoming_size=1)


class FakeMarkReadyResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def one(self):
        return self._value

    def scalar_one(self):
        return self._value


class FakeMarkReadySession:
    def __init__(self, *, engine, target):
        self._engine = engine
        self._target = target

    async def execute(self, _statement, _parameters=None):
        statement = str(_statement)
        if "pg_advisory_xact_lock" in statement:
            return FakeMarkReadyResult(None)
        # The row lock is the only non-aggregate FOR UPDATE read in mark_ready.
        if "FOR UPDATE" in statement and "count(" not in statement:
            return FakeMarkReadyResult(self._target)
        if statement.lstrip().startswith("SELECT session_attachments.session_id"):
            return FakeMarkReadyResult(self._target.session_id)
        if "sum(session_attachments.size)" in statement:
            ready = [
                attachment
                for attachment in self._engine.attachments
                if attachment.state == AttachmentState.READY.value
            ]
            return FakeMarkReadyResult(
                (len(ready), sum(attachment.size for attachment in ready))
            )
        if "count(session_attachments.id)" in statement:
            pending_count = sum(
                attachment.state == AttachmentState.PENDING.value
                for attachment in self._engine.attachments
            )
            return FakeMarkReadyResult(pending_count)
        raise AssertionError(f"Unexpected statement: {statement}")

    async def commit(self):
        return None

    async def refresh(self, _attachment, attribute_names=None):
        return None


class FakeMarkReadyEngine:
    def __init__(self, *, attachments, targets):
        self.attachments = attachments
        self._targets = iter(targets)

    @asynccontextmanager
    async def session(self):
        yield FakeMarkReadySession(engine=self, target=next(self._targets))


def _attachment(*, project_id, session_id, state, size):
    attachment_id = uuid4()
    return SessionAttachmentDBE(
        id=attachment_id,
        project_id=project_id,
        session_id=session_id,
        mount_id=uuid4(),
        path=f"{attachment_id}/file.bin",
        filename="file.bin",
        media_type="application/octet-stream",
        size=size,
        kind="other",
        state=state.value,
        idempotency_key=str(attachment_id),
        content_digest=attachment_id.hex,
    )


async def test_sequential_ready_transitions_cannot_exceed_count_quota():
    project_id = uuid4()
    session_id = "count-session"
    ready = [
        _attachment(
            project_id=project_id,
            session_id=session_id,
            state=AttachmentState.READY,
            size=1,
        )
        for _ in range(99)
    ]
    first_pending = _attachment(
        project_id=project_id,
        session_id=session_id,
        state=AttachmentState.PENDING,
        size=1,
    )
    second_pending = _attachment(
        project_id=project_id,
        session_id=session_id,
        state=AttachmentState.PENDING,
        size=1,
    )
    engine = FakeMarkReadyEngine(
        attachments=[*ready, first_pending, second_pending],
        targets=[first_pending, second_pending],
    )
    dao = SessionAttachmentsDAO(engine=engine)

    first = await dao.mark_ready(
        project_id=project_id,
        attachment_id=first_pending.id,
        limits=LIMITS,
    )
    with pytest.raises(AttachmentQuotaExceeded) as exc_info:
        await dao.mark_ready(
            project_id=project_id,
            attachment_id=second_pending.id,
            limits=LIMITS,
        )

    assert first is not None
    assert first.state == AttachmentState.READY
    assert exc_info.value.quota == "count"
    assert second_pending.state == AttachmentState.PENDING.value


async def test_sequential_ready_transitions_cannot_exceed_byte_quota():
    project_id = uuid4()
    session_id = "byte-session"
    ready = _attachment(
        project_id=project_id,
        session_id=session_id,
        state=AttachmentState.READY,
        size=999,
    )
    first_pending = _attachment(
        project_id=project_id,
        session_id=session_id,
        state=AttachmentState.PENDING,
        size=1,
    )
    second_pending = _attachment(
        project_id=project_id,
        session_id=session_id,
        state=AttachmentState.PENDING,
        size=1,
    )
    engine = FakeMarkReadyEngine(
        attachments=[ready, first_pending, second_pending],
        targets=[first_pending, second_pending],
    )
    dao = SessionAttachmentsDAO(engine=engine)

    first = await dao.mark_ready(
        project_id=project_id,
        attachment_id=first_pending.id,
        limits=LIMITS,
    )
    with pytest.raises(AttachmentQuotaExceeded) as exc_info:
        await dao.mark_ready(
            project_id=project_id,
            attachment_id=second_pending.id,
            limits=LIMITS,
        )

    assert first is not None
    assert first.state == AttachmentState.READY
    assert exc_info.value.quota == "bytes"
    assert second_pending.state == AttachmentState.PENDING.value
