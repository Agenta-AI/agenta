from typing import Literal
from uuid import UUID

from oss.src.core.sessions.attachments.dtos import (
    AttachmentLimits,
    AttachmentQuotaUsage,
)


class AttachmentError(Exception):
    """Base exception for session attachment errors."""


class AttachmentInvalid(AttachmentError):
    def __init__(self, message: str = "The attachment is not a valid file."):
        self.message = message
        super().__init__(message)


class AttachmentRequestInvalid(AttachmentError):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class AttachmentConflict(AttachmentError):
    def __init__(
        self,
        message: str = "The idempotency key is already associated with a different upload.",
    ):
        self.message = message
        super().__init__(message)


class AttachmentLengthRequired(AttachmentError):
    def __init__(self):
        self.message = "Content-Length is required for attachment uploads."
        super().__init__(self.message)


class AttachmentTooLarge(AttachmentError):
    def __init__(self, *, size: int, limit: int):
        self.size = size
        self.limit = limit
        self.message = f"The attachment exceeds the {limit}-byte limit."
        super().__init__(self.message)


class AttachmentQuotaExceeded(AttachmentError):
    def __init__(
        self,
        *,
        quota: Literal["count", "bytes", "pending"],
        limit: int,
    ):
        self.quota = quota
        self.limit = limit
        self.message = f"The session attachment {quota} quota of {limit} is exhausted."
        super().__init__(self.message)


class AttachmentUploadInFlight(AttachmentError):
    def __init__(self, *, attachment_id: UUID, retry_after_seconds: int):
        self.attachment_id = attachment_id
        self.retry_after_seconds = retry_after_seconds
        self.message = "An upload with this idempotency key is already in progress."
        super().__init__(self.message)


class AttachmentNotFound(AttachmentError):
    def __init__(self, *, attachment_id: UUID):
        self.attachment_id = attachment_id
        self.message = "Attachment not found."
        super().__init__(self.message)


class AttachmentStateConflict(AttachmentError):
    def __init__(self, *, attachment_id: UUID):
        self.attachment_id = attachment_id
        self.message = "The attachment state changed during upload."
        super().__init__(self.message)


def enforce_stored_attachment_quota(
    *,
    usage: AttachmentQuotaUsage,
    limits: AttachmentLimits,
    incoming_size: int,
) -> None:
    if usage.stored_count >= limits.max_per_session_count:
        raise AttachmentQuotaExceeded(
            quota="count",
            limit=limits.max_per_session_count,
        )
    if usage.stored_bytes + incoming_size > limits.max_per_session_bytes:
        raise AttachmentQuotaExceeded(
            quota="bytes",
            limit=limits.max_per_session_bytes,
        )


def enforce_attachment_quota(
    *,
    usage: AttachmentQuotaUsage,
    limits: AttachmentLimits,
    incoming_size: int,
) -> None:
    enforce_stored_attachment_quota(
        usage=usage,
        limits=limits,
        incoming_size=incoming_size,
    )
    if usage.pending_count >= limits.max_pending_per_session:
        raise AttachmentQuotaExceeded(
            quota="pending",
            limit=limits.max_pending_per_session,
        )
