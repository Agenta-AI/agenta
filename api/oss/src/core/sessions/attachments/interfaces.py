from abc import ABC, abstractmethod
from datetime import datetime
from typing import Awaitable, Callable, List, Optional, Protocol
from uuid import UUID

from oss.src.core.sessions.attachments.dtos import (
    Attachment,
    AttachmentCreate,
    AttachmentLimits,
    AttachmentQuotaUsage,
    AttachmentReferenceResult,
    AttachmentReservation,
)


class AttachmentOriginalStore(Protocol):
    async def get_or_create_attachment_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
    ) -> UUID: ...

    async def write_attachment_original(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
        data: bytes,
    ) -> None: ...

    async def read_attachment_original(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
    ) -> bytes: ...

    async def delete_attachment_original(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
    ) -> None: ...


AttachmentOriginalDelete = Callable[[Attachment], Awaitable[None]]


class SessionAttachmentsDAOInterface(ABC):
    @abstractmethod
    async def fetch_by_idempotency_key(
        self,
        *,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
    ) -> Optional[Attachment]: ...

    @abstractmethod
    async def get_quota_usage(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> AttachmentQuotaUsage: ...

    @abstractmethod
    async def reserve_pending(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        attachment_create: AttachmentCreate,
        limits: AttachmentLimits,
        stale_before: datetime,
    ) -> AttachmentReservation: ...

    @abstractmethod
    async def mark_ready(
        self,
        *,
        project_id: UUID,
        attachment_id: UUID,
        limits: AttachmentLimits,
    ) -> Optional[Attachment]: ...

    @abstractmethod
    async def delete_pending(
        self,
        *,
        project_id: UUID,
        attachment_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def fetch_ready(
        self,
        *,
        project_id: UUID,
        session_id: str,
        attachment_id: UUID,
    ) -> Optional[Attachment]: ...

    @abstractmethod
    async def reference_ready(
        self,
        *,
        project_id: UUID,
        session_id: str,
        attachment_ids: List[UUID],
        referenced_at: datetime,
    ) -> AttachmentReferenceResult: ...

    @abstractmethod
    async def reap_stale_pending(
        self,
        *,
        older_than: datetime,
        delete_original: AttachmentOriginalDelete,
        limit: int = 100,
    ) -> List[Attachment]: ...

    @abstractmethod
    async def sweep_unreferenced_ready(
        self,
        *,
        older_than: datetime,
        delete_original: AttachmentOriginalDelete,
        limit: int = 100,
    ) -> List[Attachment]: ...
