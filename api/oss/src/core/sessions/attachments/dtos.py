from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import Identifier, Lifecycle


class AttachmentState(str, Enum):
    PENDING = "pending"
    READY = "ready"
    DELETING = "deleting"


class AttachmentKind(str, Enum):
    IMAGE = "image"
    AUDIO = "audio"
    DOCUMENT = "document"
    OTHER = "other"


class AttachmentMedia(BaseModel):
    media_type: str
    kind: AttachmentKind
    native_image: bool


class Attachment(Identifier, Lifecycle):
    project_id: UUID
    session_id: str
    mount_id: UUID
    path: str
    filename: str
    media_type: str
    size: int
    kind: AttachmentKind
    state: AttachmentState
    idempotency_key: str
    content_digest: str
    referenced_at: Optional[datetime] = None


class AttachmentCreate(BaseModel):
    id: UUID
    session_id: str
    mount_id: UUID
    path: str
    filename: str
    media_type: str
    size: int
    kind: AttachmentKind
    idempotency_key: str
    content_digest: str


class AttachmentContent(BaseModel):
    attachment: Attachment
    data: bytes


class AttachmentLimits(BaseModel):
    max_image_bytes: int = 10 * 1024 * 1024
    max_audio_bytes: int = 15 * 1024 * 1024
    max_document_bytes: int = 10 * 1024 * 1024
    max_other_bytes: int = 10 * 1024 * 1024
    max_per_session_count: int = 1000
    max_per_session_bytes: int = 256 * 1024 * 1024
    max_pending_per_session: int = 20
    pending_ttl_seconds: int = 15 * 60

    @property
    def max_raw_bytes(self) -> int:
        return max(
            self.max_image_bytes,
            self.max_audio_bytes,
            self.max_document_bytes,
            self.max_other_bytes,
        )

    def max_bytes_for(self, *, kind: AttachmentKind) -> int:
        return {
            AttachmentKind.IMAGE: self.max_image_bytes,
            AttachmentKind.AUDIO: self.max_audio_bytes,
            AttachmentKind.DOCUMENT: self.max_document_bytes,
            AttachmentKind.OTHER: self.max_other_bytes,
        }[kind]


class AttachmentQuotaUsage(BaseModel):
    stored_count: int = 0
    stored_bytes: int = 0
    pending_count: int = 0


class AttachmentReservationStatus(str, Enum):
    CREATED = "created"
    READY = "ready"
    IN_FLIGHT = "in_flight"
    TAKEN_OVER = "taken_over"
    CONFLICT = "conflict"


class AttachmentReservation(BaseModel):
    attachment: Attachment
    status: AttachmentReservationStatus


class AttachmentReferenceResult(BaseModel):
    """Outcome of a reference claim: nothing is claimed unless every id resolved."""

    attachments: List[Attachment] = Field(default_factory=list)
    missing_ids: List[UUID] = Field(default_factory=list)
