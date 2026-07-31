from datetime import datetime
from uuid import UUID

from oss.src.core.sessions.attachments.dtos import (
    Attachment,
    AttachmentCreate,
    AttachmentKind,
    AttachmentState,
)
from oss.src.dbs.postgres.sessions.attachments.dbes import SessionAttachmentDBE


def map_attachment_create_to_dbe(
    *,
    project_id: UUID,
    user_id: UUID,
    attachment_create: AttachmentCreate,
) -> SessionAttachmentDBE:
    return SessionAttachmentDBE(
        id=attachment_create.id,
        project_id=project_id,
        created_by_id=user_id,
        session_id=attachment_create.session_id,
        mount_id=attachment_create.mount_id,
        path=attachment_create.path,
        filename=attachment_create.filename,
        media_type=attachment_create.media_type,
        size=attachment_create.size,
        kind=attachment_create.kind.value,
        state=AttachmentState.PENDING.value,
        idempotency_key=attachment_create.idempotency_key,
        content_digest=attachment_create.content_digest,
    )


def map_attachment_dbe_to_dto(
    *,
    attachment_dbe: SessionAttachmentDBE,
) -> Attachment:
    return Attachment(
        id=attachment_dbe.id,
        created_at=attachment_dbe.created_at,
        updated_at=attachment_dbe.updated_at,
        deleted_at=attachment_dbe.deleted_at,
        created_by_id=attachment_dbe.created_by_id,
        updated_by_id=attachment_dbe.updated_by_id,
        deleted_by_id=attachment_dbe.deleted_by_id,
        project_id=attachment_dbe.project_id,
        session_id=attachment_dbe.session_id,
        mount_id=attachment_dbe.mount_id,
        path=attachment_dbe.path,
        filename=attachment_dbe.filename,
        media_type=attachment_dbe.media_type,
        size=attachment_dbe.size,
        kind=AttachmentKind(attachment_dbe.kind),
        state=AttachmentState(attachment_dbe.state),
        idempotency_key=attachment_dbe.idempotency_key,
        content_digest=attachment_dbe.content_digest,
        referenced_at=attachment_dbe.referenced_at,
    )


def refresh_pending_takeover(
    *,
    attachment_dbe: SessionAttachmentDBE,
    user_id: UUID,
    now: datetime,
) -> None:
    attachment_dbe.created_at = now
    attachment_dbe.updated_at = now
    attachment_dbe.updated_by_id = user_id
