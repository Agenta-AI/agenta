import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, text

from oss.src.core.mounts.dtos import MountCreate
from oss.src.core.mounts.types import ATTACHMENTS_MOUNT_PURPOSE
from oss.src.core.sessions.attachments.dtos import (
    Attachment,
    AttachmentCreate,
    AttachmentKind,
    AttachmentLimits,
    AttachmentReservationStatus,
    AttachmentState,
)
from oss.src.core.sessions.attachments.types import AttachmentQuotaExceeded
from oss.src.dbs.postgres.mounts.dao import MountsDAO
from oss.src.dbs.postgres.sessions.attachments.dao import SessionAttachmentsDAO
from oss.src.dbs.postgres.sessions.attachments.dbes import SessionAttachmentDBE
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
import oss.src.models.db_models  # noqa: F401


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    # Dispose before dropping the reference, or the previous engine's pooled connections leak.
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def attachment_scope():
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "attachment-dao-test",
                "email": f"attachment-dao-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "attachment-dao-test-org",
                "owner_id": user_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "attachment-dao-test-workspace",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :project_name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "project_name": "attachment-dao-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.commit()

    mount = await MountsDAO(engine=engine).create_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(slug=f"attachment-dao-{project_id.hex}"),
    )

    yield {
        "engine": engine,
        "project_id": project_id,
        "user_id": user_id,
        "mount_id": mount.id,
    }

    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM session_attachments WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM mounts WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )
        await session.execute(
            text("DELETE FROM workspaces WHERE id = :id"), {"id": workspace_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"),
            {"id": organization_id},
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()


async def _reserve(
    *,
    dao: SessionAttachmentsDAO,
    attachment_scope,
    session_id: str,
    idempotency_key: str,
) -> Attachment:
    attachment_id = uuid.uuid4()
    reservation = await dao.reserve_pending(
        project_id=attachment_scope["project_id"],
        user_id=attachment_scope["user_id"],
        attachment_create=AttachmentCreate(
            id=attachment_id,
            session_id=session_id,
            mount_id=attachment_scope["mount_id"],
            path=f"{attachment_id}/file.txt",
            filename="file.txt",
            media_type="text/plain",
            size=1,
            kind=AttachmentKind.DOCUMENT,
            idempotency_key=idempotency_key,
            content_digest=attachment_id.hex,
        ),
        limits=AttachmentLimits(),
        stale_before=datetime.now(timezone.utc) - timedelta(minutes=15),
    )
    assert reservation.status == AttachmentReservationStatus.CREATED
    return reservation.attachment


async def test_sweep_tombstone_wins_against_concurrent_claim(attachment_scope):
    dao = SessionAttachmentsDAO(engine=attachment_scope["engine"])
    session_id = f"attachment-sweep-{uuid.uuid4().hex[:8]}"
    pending = await _reserve(
        dao=dao,
        attachment_scope=attachment_scope,
        session_id=session_id,
        idempotency_key="sweep-race",
    )
    ready = await dao.mark_ready(
        project_id=attachment_scope["project_id"],
        attachment_id=pending.id,
        limits=AttachmentLimits(),
    )
    assert ready is not None

    async with attachment_scope["engine"].session() as session:
        await session.execute(
            text(
                "UPDATE session_attachments SET created_at = :created_at "
                "WHERE project_id = :project_id AND id = :attachment_id"
            ),
            {
                "created_at": datetime.now(timezone.utc) - timedelta(days=2),
                "project_id": attachment_scope["project_id"],
                "attachment_id": ready.id,
            },
        )
        await session.commit()

    object_delete_started = asyncio.Event()
    allow_object_delete = asyncio.Event()

    async def delete_original(_attachment):
        object_delete_started.set()
        await allow_object_delete.wait()

    sweep_task = asyncio.create_task(
        dao.sweep_unreferenced_ready(
            older_than=datetime.now(timezone.utc) - timedelta(days=1),
            delete_original=delete_original,
            limit=1,
        )
    )
    await asyncio.wait_for(object_delete_started.wait(), timeout=5)

    claimed = await asyncio.wait_for(
        dao.reference_ready(
            project_id=attachment_scope["project_id"],
            session_id=session_id,
            attachment_ids=[ready.id],
            referenced_at=datetime.now(timezone.utc),
        ),
        timeout=30,
    )
    allow_object_delete.set()
    deleted = await asyncio.wait_for(sweep_task, timeout=5)

    assert claimed.attachments == []
    assert claimed.missing_ids == [ready.id]
    assert [attachment.id for attachment in deleted] == [ready.id]
    async with attachment_scope["engine"].session() as session:
        row = await session.get(
            SessionAttachmentDBE,
            (attachment_scope["project_id"], ready.id),
        )
    assert row is None


async def test_sweep_skips_a_row_claimed_before_the_pass(attachment_scope):
    dao = SessionAttachmentsDAO(engine=attachment_scope["engine"])
    session_id = f"attachment-claimed-{uuid.uuid4().hex[:8]}"
    pending = await _reserve(
        dao=dao,
        attachment_scope=attachment_scope,
        session_id=session_id,
        idempotency_key="claim-first",
    )
    ready = await dao.mark_ready(
        project_id=attachment_scope["project_id"],
        attachment_id=pending.id,
        limits=AttachmentLimits(),
    )
    assert ready is not None

    async with attachment_scope["engine"].session() as session:
        await session.execute(
            text(
                "UPDATE session_attachments SET created_at = :created_at "
                "WHERE project_id = :project_id AND id = :attachment_id"
            ),
            {
                "created_at": datetime.now(timezone.utc) - timedelta(days=2),
                "project_id": attachment_scope["project_id"],
                "attachment_id": ready.id,
            },
        )
        await session.commit()

    claimed = await asyncio.wait_for(
        dao.reference_ready(
            project_id=attachment_scope["project_id"],
            session_id=session_id,
            attachment_ids=[ready.id],
            referenced_at=datetime.now(timezone.utc),
        ),
        timeout=30,
    )
    assert [attachment.id for attachment in claimed.attachments] == [ready.id]

    deleted_ids = []

    async def delete_original(attachment):
        deleted_ids.append(attachment.id)

    swept = await asyncio.wait_for(
        dao.sweep_unreferenced_ready(
            older_than=datetime.now(timezone.utc) - timedelta(days=1),
            delete_original=delete_original,
            limit=100,
        ),
        timeout=30,
    )

    assert ready.id not in deleted_ids
    assert ready.id not in [attachment.id for attachment in swept]
    async with attachment_scope["engine"].session() as session:
        row = await session.get(
            SessionAttachmentDBE,
            (attachment_scope["project_id"], ready.id),
        )
        assert row is not None
        assert row.state == AttachmentState.READY.value
        assert row.referenced_at is not None


async def test_rebinding_a_mount_backfills_its_purpose(attachment_scope):
    mounts_dao = MountsDAO(engine=attachment_scope["engine"])
    slug = f"attachment-purpose-{uuid.uuid4().hex}"

    legacy = await mounts_dao.upsert_mount(
        project_id=attachment_scope["project_id"],
        user_id=attachment_scope["user_id"],
        mount_create=MountCreate(slug=slug, name="attachments"),
    )
    assert legacy.purpose is None

    rebound = await mounts_dao.upsert_mount(
        project_id=attachment_scope["project_id"],
        user_id=attachment_scope["user_id"],
        mount_create=MountCreate(
            slug=slug,
            name="attachments",
            purpose=ATTACHMENTS_MOUNT_PURPOSE,
        ),
    )

    assert rebound.id == legacy.id
    assert rebound.purpose == ATTACHMENTS_MOUNT_PURPOSE


async def test_quota_recheck_is_serialized_by_session_advisory_lock(
    attachment_scope,
):
    dao = SessionAttachmentsDAO(engine=attachment_scope["engine"])
    session_id = f"attachment-quota-{uuid.uuid4().hex[:8]}"
    first = await _reserve(
        dao=dao,
        attachment_scope=attachment_scope,
        session_id=session_id,
        idempotency_key="quota-first",
    )
    second = await _reserve(
        dao=dao,
        attachment_scope=attachment_scope,
        session_id=session_id,
        idempotency_key="quota-second",
    )
    limits = AttachmentLimits(max_per_session_count=1)

    # Bounded: both calls contend for the same advisory lock on separate pooled
    # connections, so a regression here would hang the run instead of failing it.
    results = await asyncio.wait_for(
        asyncio.gather(
            dao.mark_ready(
                project_id=attachment_scope["project_id"],
                attachment_id=first.id,
                limits=limits,
            ),
            dao.mark_ready(
                project_id=attachment_scope["project_id"],
                attachment_id=second.id,
                limits=limits,
            ),
            return_exceptions=True,
        ),
        timeout=30,
    )

    assert sum(isinstance(result, Attachment) for result in results) == 1
    assert sum(isinstance(result, AttachmentQuotaExceeded) for result in results) == 1
    async with attachment_scope["engine"].session() as session:
        ready_count = await session.scalar(
            select(func.count(SessionAttachmentDBE.id)).where(
                SessionAttachmentDBE.project_id == attachment_scope["project_id"],
                SessionAttachmentDBE.session_id == session_id,
                SessionAttachmentDBE.state == AttachmentState.READY.value,
            )
        )
    assert ready_count == 1
