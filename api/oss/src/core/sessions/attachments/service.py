from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

import uuid_utils.compat as uuid_utils

from oss.src.core.sessions.attachments.dtos import (
    Attachment,
    AttachmentContent,
    AttachmentCreate,
    AttachmentLimits,
    AttachmentReservationStatus,
    AttachmentState,
)
from oss.src.core.sessions.attachments.interfaces import (
    AttachmentOriginalStore,
    SessionAttachmentsDAOInterface,
)
from oss.src.core.sessions.attachments.media import classify
from oss.src.core.sessions.attachments.types import (
    AttachmentInvalid,
    AttachmentNotFound,
    AttachmentStateConflict,
    AttachmentTooLarge,
    AttachmentUploadInFlight,
    enforce_attachment_quota,
)


def sanitize_attachment_filename(filename: Optional[str]) -> str:
    if not filename:
        return "attachment"
    if any(ord(character) < 0x20 or character == "\x7f" for character in filename):
        raise AttachmentInvalid("The attachment filename contains control characters.")

    basename = filename.replace("\\", "/").split("/")[-1]
    if basename in {"", ".", ".."}:
        return "attachment"
    return basename


class SessionAttachmentsService:
    def __init__(
        self,
        *,
        attachments_dao: SessionAttachmentsDAOInterface,
        original_store: AttachmentOriginalStore,
        limits: Optional[AttachmentLimits] = None,
    ) -> None:
        self._dao = attachments_dao
        self._original_store = original_store
        self.limits = limits or AttachmentLimits()

    async def create_attachment(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        idempotency_key: str,
        filename: Optional[str],
        declared_media_type: Optional[str],
        data: bytes,
    ) -> Attachment:
        media = classify(data=data, declared_media_type=declared_media_type)
        size = len(data)
        kind_limit = self.limits.max_bytes_for(kind=media.kind)
        if size > kind_limit:
            raise AttachmentTooLarge(size=size, limit=kind_limit)

        safe_filename = sanitize_attachment_filename(filename)
        existing = await self._dao.fetch_by_idempotency_key(
            project_id=project_id,
            session_id=session_id,
            idempotency_key=idempotency_key,
        )
        if existing is not None:
            if existing.state == AttachmentState.READY:
                return existing
            if not self._is_stale_pending(existing=existing):
                raise AttachmentUploadInFlight(attachment_id=existing.id)
            self._validate_takeover(
                existing=existing,
                filename=safe_filename,
                media_type=media.media_type,
                size=size,
            )

        if existing is None:
            usage = await self._dao.get_quota_usage(
                project_id=project_id,
                session_id=session_id,
            )
            enforce_attachment_quota(
                usage=usage,
                limits=self.limits,
                incoming_size=size,
            )
            mount_id = await self._original_store.get_or_create_attachment_mount(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
            )
        else:
            mount_id = existing.mount_id

        attachment_id = uuid_utils.uuid7()
        reservation = await self._dao.reserve_pending(
            project_id=project_id,
            user_id=user_id,
            attachment_create=AttachmentCreate(
                id=attachment_id,
                session_id=session_id,
                mount_id=mount_id,
                path=f"{attachment_id}/{safe_filename}",
                filename=safe_filename,
                media_type=media.media_type,
                size=size,
                kind=media.kind,
                idempotency_key=idempotency_key,
            ),
            limits=self.limits,
            stale_before=self._pending_stale_before(),
        )

        if reservation.status == AttachmentReservationStatus.READY:
            return reservation.attachment
        if reservation.status == AttachmentReservationStatus.IN_FLIGHT:
            raise AttachmentUploadInFlight(
                attachment_id=reservation.attachment.id,
            )
        if reservation.status == AttachmentReservationStatus.CONFLICT:
            raise AttachmentInvalid(
                "The idempotency key is already associated with a different upload."
            )

        await self._original_store.write_attachment_original(
            project_id=project_id,
            mount_id=reservation.attachment.mount_id,
            path=reservation.attachment.path,
            data=data,
        )
        ready = await self._dao.mark_ready(
            project_id=project_id,
            attachment_id=reservation.attachment.id,
            limits=self.limits,
        )
        if ready is None:
            raise AttachmentStateConflict(
                attachment_id=reservation.attachment.id,
            )
        return ready

    async def fetch_attachment_content(
        self,
        *,
        project_id: UUID,
        session_id: str,
        attachment_id: UUID,
    ) -> AttachmentContent:
        attachment = await self._dao.fetch_ready(
            project_id=project_id,
            session_id=session_id,
            attachment_id=attachment_id,
        )
        if attachment is None:
            raise AttachmentNotFound(attachment_id=attachment_id)

        data = await self._original_store.read_attachment_original(
            project_id=project_id,
            mount_id=attachment.mount_id,
            path=attachment.path,
        )
        return AttachmentContent(attachment=attachment, data=data)

    async def reference_attachments(
        self,
        *,
        project_id: UUID,
        session_id: str,
        attachment_ids: List[UUID],
    ) -> List[Attachment]:
        ordered_ids = list(dict.fromkeys(attachment_ids))
        attachments = await self._dao.reference_ready(
            project_id=project_id,
            session_id=session_id,
            attachment_ids=ordered_ids,
            referenced_at=datetime.now(timezone.utc),
        )
        if attachments is None:
            missing_id = ordered_ids[0] if ordered_ids else UUID(int=0)
            raise AttachmentNotFound(attachment_id=missing_id)
        return attachments

    def _pending_stale_before(self) -> datetime:
        return datetime.now(timezone.utc) - timedelta(
            seconds=self.limits.pending_ttl_seconds
        )

    def _is_stale_pending(self, *, existing: Attachment) -> bool:
        return bool(
            existing.created_at is not None
            and existing.created_at < self._pending_stale_before()
        )

    @staticmethod
    def _validate_takeover(
        *,
        existing: Attachment,
        filename: str,
        media_type: str,
        size: int,
    ) -> None:
        if (
            existing.filename != filename
            or existing.media_type != media_type
            or existing.size != size
        ):
            raise AttachmentInvalid(
                "The idempotency key is already associated with a different upload."
            )
