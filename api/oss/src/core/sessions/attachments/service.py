from datetime import datetime, timedelta, timezone
from hashlib import sha256
from math import ceil
from typing import List, Optional
from uuid import UUID

import uuid_utils.compat as uuid_utils

from oss.src.core.sessions.attachments.dtos import (
    Attachment,
    AttachmentContent,
    AttachmentCreate,
    AttachmentLimits,
    AttachmentReservationStatus,
)
from oss.src.core.sessions.attachments.interfaces import (
    AttachmentOriginalStore,
    SessionAttachmentsDAOInterface,
)
from oss.src.core.sessions.attachments.media import classify
from oss.src.core.sessions.attachments.types import (
    AttachmentConflict,
    AttachmentNotFound,
    AttachmentQuotaExceeded,
    AttachmentRequestInvalid,
    AttachmentStateConflict,
    AttachmentTooLarge,
    AttachmentUploadInFlight,
)
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)
_MAX_FILENAME_CHARACTERS = 200


def sanitize_attachment_filename(filename: Optional[str]) -> str:
    if not filename:
        return "attachment"
    if any(ord(character) < 0x20 or character == "\x7f" for character in filename):
        raise AttachmentRequestInvalid(
            "The attachment filename contains control characters."
        )

    basename = filename.replace("\\", "/").split("/")[-1]
    if basename in {"", ".", ".."}:
        return "attachment"
    if len(basename) <= _MAX_FILENAME_CHARACTERS:
        return basename

    stem, separator, extension = basename.rpartition(".")
    suffix = f"{separator}{extension}" if stem and separator else ""
    # Keep attachment paths below the object-store key limit without losing the type suffix.
    if suffix and len(suffix) < _MAX_FILENAME_CHARACTERS:
        return f"{stem[: _MAX_FILENAME_CHARACTERS - len(suffix)]}{suffix}"
    return basename[:_MAX_FILENAME_CHARACTERS]


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
        mount_id = await self._original_store.get_or_create_attachment_mount(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
        )

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
                content_digest=sha256(data).hexdigest(),
            ),
            limits=self.limits,
            stale_before=self._pending_stale_before(),
        )

        if reservation.status == AttachmentReservationStatus.READY:
            return reservation.attachment
        if reservation.status == AttachmentReservationStatus.IN_FLIGHT:
            raise AttachmentUploadInFlight(
                attachment_id=reservation.attachment.id,
                retry_after_seconds=self._pending_retry_after_seconds(
                    attachment=reservation.attachment
                ),
            )
        if reservation.status == AttachmentReservationStatus.CONFLICT:
            raise AttachmentConflict()

        # A takeover falls through with the existing row's id and path from the reservation.
        try:
            await self._original_store.write_attachment_original(
                project_id=project_id,
                mount_id=reservation.attachment.mount_id,
                path=reservation.attachment.path,
                data=data,
            )
        except Exception:
            await self._delete_pending_best_effort(
                project_id=project_id,
                attachment_id=reservation.attachment.id,
            )
            raise

        try:
            ready = await self._dao.mark_ready(
                project_id=project_id,
                attachment_id=reservation.attachment.id,
                limits=self.limits,
            )
        except AttachmentQuotaExceeded:
            # Dropping the row before the object is gone would orphan the object with nothing
            # left to retry from; a surviving PENDING row lets the sweep reclaim both.
            if await self._delete_original_best_effort(
                project_id=project_id,
                attachment=reservation.attachment,
            ):
                await self._delete_pending_best_effort(
                    project_id=project_id,
                    attachment_id=reservation.attachment.id,
                )
            raise
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
        result = await self._dao.reference_ready(
            project_id=project_id,
            session_id=session_id,
            attachment_ids=attachment_ids,
            referenced_at=datetime.now(timezone.utc),
        )
        if result.missing_ids:
            raise AttachmentNotFound(attachment_id=result.missing_ids[0])
        return result.attachments

    def _pending_stale_before(self) -> datetime:
        return datetime.now(timezone.utc) - timedelta(
            seconds=self.limits.pending_ttl_seconds
        )

    def _pending_retry_after_seconds(self, *, attachment: Attachment) -> int:
        now = datetime.now(timezone.utc)
        created_at = attachment.created_at or now
        remaining = (
            created_at + timedelta(seconds=self.limits.pending_ttl_seconds) - now
        ).total_seconds()
        return max(1, ceil(remaining))

    async def _delete_pending_best_effort(
        self,
        *,
        project_id: UUID,
        attachment_id: UUID,
    ) -> None:
        try:
            await self._dao.delete_pending(
                project_id=project_id,
                attachment_id=attachment_id,
            )
        except Exception:
            log.error(
                "attachment_create: pending-row compensation failed for %s",
                attachment_id,
                exc_info=True,
            )

    async def _delete_original_best_effort(
        self,
        *,
        project_id: UUID,
        attachment: Attachment,
    ) -> bool:
        try:
            await self._original_store.delete_attachment_original(
                project_id=project_id,
                mount_id=attachment.mount_id,
                path=attachment.path,
            )
        except Exception:
            log.error(
                "attachment_create: object compensation failed for %s",
                attachment.id,
                exc_info=True,
            )
            return False
        return True
