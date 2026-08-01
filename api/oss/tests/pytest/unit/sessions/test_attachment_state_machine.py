from unittest.mock import AsyncMock

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import List, Optional
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request

from oss.src.core.sessions.attachments.dtos import (
    Attachment,
    AttachmentCreate,
    AttachmentKind,
    AttachmentLimits,
    AttachmentQuotaUsage,
    AttachmentReferenceResult,
    AttachmentReservation,
    AttachmentReservationStatus,
    AttachmentState,
)
from oss.src.apis.fastapi.sessions.router import (
    _ATTACHMENT_MULTIPART_OVERHEAD_BYTES,
    _MAX_IDEMPOTENCY_KEY_CHARACTERS,
    SessionAttachmentsRouter,
)
from oss.src.apis.fastapi.sessions.models import SessionAttachmentReferenceRequest
from oss.src.core.mounts.types import MountStorageUnavailable
from oss.src.core.sessions.attachments.service import SessionAttachmentsService
from oss.src.core.sessions.attachments.types import AttachmentNotFound
from oss.src.core.sessions.attachments.types import (
    AttachmentConflict,
    AttachmentQuotaExceeded,
    AttachmentUploadInFlight,
)


class FakeAttachmentsDAO:
    # Keyed like the composite unique index the DAO relies on, so the reservation store and
    # the project/session-scoped lookups cannot disagree.
    def __init__(self) -> None:
        self.attachments: dict[tuple[UUID, str, str], Attachment] = {}
        self.fail_mark_ready = False
        self.reject_mark_ready_for_quota = False

    @staticmethod
    def _key(
        *,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
    ) -> tuple[UUID, str, str]:
        return (project_id, session_id, idempotency_key)

    async def fetch_by_idempotency_key(
        self,
        *,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
    ) -> Optional[Attachment]:
        return self.attachments.get(
            self._key(
                project_id=project_id,
                session_id=session_id,
                idempotency_key=idempotency_key,
            )
        )

    async def get_quota_usage(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> AttachmentQuotaUsage:
        scoped = [
            attachment
            for attachment in self.attachments.values()
            if attachment.project_id == project_id
            and attachment.session_id == session_id
        ]
        ready = [
            attachment
            for attachment in scoped
            if attachment.state == AttachmentState.READY
            or attachment.referenced_at is not None
        ]
        return AttachmentQuotaUsage(
            stored_count=len(ready),
            stored_bytes=sum(attachment.size for attachment in ready),
            pending_count=sum(
                attachment.state == AttachmentState.PENDING for attachment in scoped
            ),
        )

    async def reserve_pending(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        attachment_create: AttachmentCreate,
        limits: AttachmentLimits,
        stale_before: datetime,
    ) -> AttachmentReservation:
        key = self._key(
            project_id=project_id,
            session_id=attachment_create.session_id,
            idempotency_key=attachment_create.idempotency_key,
        )
        existing = self.attachments.get(key)
        if existing is not None:
            same_upload = (
                existing.filename == attachment_create.filename
                and existing.media_type == attachment_create.media_type
                and existing.size == attachment_create.size
                and existing.content_digest == attachment_create.content_digest
            )
            if not same_upload:
                status = AttachmentReservationStatus.CONFLICT
            elif existing.state == AttachmentState.READY:
                status = AttachmentReservationStatus.READY
            elif existing.state == AttachmentState.DELETING:
                status = AttachmentReservationStatus.IN_FLIGHT
            else:
                status = (
                    AttachmentReservationStatus.TAKEN_OVER
                    if existing.created_at is not None
                    and existing.created_at < stale_before
                    else AttachmentReservationStatus.IN_FLIGHT
                )
            return AttachmentReservation(attachment=existing, status=status)

        attachment = Attachment(
            id=attachment_create.id,
            project_id=project_id,
            session_id=attachment_create.session_id,
            mount_id=attachment_create.mount_id,
            path=attachment_create.path,
            filename=attachment_create.filename,
            media_type=attachment_create.media_type,
            size=attachment_create.size,
            kind=attachment_create.kind,
            state=AttachmentState.PENDING,
            idempotency_key=attachment_create.idempotency_key,
            content_digest=attachment_create.content_digest,
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
        )
        self.attachments[key] = attachment
        return AttachmentReservation(
            attachment=attachment,
            status=AttachmentReservationStatus.CREATED,
        )

    async def mark_ready(
        self,
        *,
        project_id: UUID,
        attachment_id: UUID,
        limits: AttachmentLimits,
    ) -> Optional[Attachment]:
        if self.fail_mark_ready:
            raise RuntimeError("database unavailable")
        if self.reject_mark_ready_for_quota:
            raise AttachmentQuotaExceeded(quota="count", limit=1)
        for key, attachment in self.attachments.items():
            if attachment.project_id == project_id and attachment.id == attachment_id:
                ready = attachment.model_copy(update={"state": AttachmentState.READY})
                self.attachments[key] = ready
                return ready
        return None

    async def delete_pending(
        self,
        *,
        project_id: UUID,
        attachment_id: UUID,
    ) -> bool:
        for key, attachment in list(self.attachments.items()):
            if (
                attachment.project_id == project_id
                and attachment.id == attachment_id
                and attachment.state == AttachmentState.PENDING
            ):
                del self.attachments[key]
                return True
        return False

    async def fetch_ready(
        self,
        *,
        project_id: UUID,
        session_id: str,
        attachment_id: UUID,
    ) -> Optional[Attachment]:
        return next(
            (
                attachment
                for attachment in self.attachments.values()
                if attachment.project_id == project_id
                and attachment.session_id == session_id
                and attachment.id == attachment_id
                and attachment.state == AttachmentState.READY
            ),
            None,
        )

    async def reference_ready(
        self,
        *,
        project_id: UUID,
        session_id: str,
        attachment_ids: List[UUID],
        referenced_at: datetime,
    ) -> AttachmentReferenceResult:
        ordered_ids = list(dict.fromkeys(attachment_ids))
        by_id = {
            attachment.id: attachment
            for attachment in self.attachments.values()
            if attachment.project_id == project_id
            and attachment.session_id == session_id
            and attachment.state == AttachmentState.READY
        }
        missing_ids = [
            attachment_id for attachment_id in ordered_ids if attachment_id not in by_id
        ]
        if missing_ids:
            return AttachmentReferenceResult(missing_ids=missing_ids)
        return AttachmentReferenceResult(
            attachments=[by_id[attachment_id] for attachment_id in ordered_ids]
        )


class FakeOriginalStore:
    def __init__(self) -> None:
        self.mount_id = uuid4()
        self.objects: dict[tuple[UUID, str], bytes] = {}
        self.write_count = 0
        self.fail_write = False
        self.fail_delete = False

    async def get_or_create_attachment_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
    ) -> UUID:
        return self.mount_id

    async def write_attachment_original(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
        data: bytes,
    ) -> None:
        self.write_count += 1
        if self.fail_write:
            raise RuntimeError("object store unavailable")
        self.objects[(mount_id, path)] = data

    async def read_attachment_original(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
    ) -> bytes:
        return self.objects[(mount_id, path)]

    async def delete_attachment_original(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
    ) -> None:
        if self.fail_delete:
            raise RuntimeError("object store unavailable")
        self.objects.pop((mount_id, path), None)


@pytest.fixture
def attachment_service():
    dao = FakeAttachmentsDAO()
    store = FakeOriginalStore()
    service = SessionAttachmentsService(
        attachments_dao=dao,
        original_store=store,
    )
    return service, dao, store


def _upload_request(
    *,
    data: bytes = b"hello",
    idempotency_key: str = "upload-a",
    content_length: int | None | object = ...,
) -> Request:
    boundary = "attachment-test-boundary"
    body = (
        (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="idempotency_key"\r\n\r\n'
            f"{idempotency_key}\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; filename="note.txt"\r\n'
            "Content-Type: text/plain\r\n\r\n"
        ).encode()
        + data
        + f"\r\n--{boundary}--\r\n".encode()
    )
    headers = [(b"content-type", f"multipart/form-data; boundary={boundary}".encode())]
    if content_length is ...:
        headers.append((b"content-length", str(len(body)).encode()))
    elif content_length is not None:
        headers.append((b"content-length", str(content_length).encode()))

    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/sessions/attachments",
            "headers": headers,
        },
        receive,
    )
    request.state.project_id = str(uuid4())
    request.state.user_id = str(uuid4())
    return request


def _store_key(
    project_id: UUID,
    *,
    session_id: str = "session-a",
    idempotency_key: str = "upload-a",
) -> tuple[UUID, str, str]:
    return FakeAttachmentsDAO._key(
        project_id=project_id,
        session_id=session_id,
        idempotency_key=idempotency_key,
    )


async def _create(
    service: SessionAttachmentsService,
    *,
    project_id: UUID,
    user_id: UUID,
    session_id: str,
    idempotency_key: str,
) -> Attachment:
    return await service.create_attachment(
        project_id=project_id,
        user_id=user_id,
        session_id=session_id,
        idempotency_key=idempotency_key,
        filename="note.txt",
        declared_media_type="text/plain",
        data=b"hello",
    )


def test_reference_request_caps_attachment_ids_at_one_hundred():
    SessionAttachmentReferenceRequest(
        session_id="session-a",
        attachment_ids=[uuid4() for _ in range(100)],
    )

    with pytest.raises(ValidationError):
        SessionAttachmentReferenceRequest(
            session_id="session-a",
            attachment_ids=[uuid4() for _ in range(101)],
        )


async def test_reference_names_the_id_that_is_not_ready(attachment_service):
    service, _, _ = attachment_service
    project_id = uuid4()
    user_id = uuid4()
    ready = await _create(
        service,
        project_id=project_id,
        user_id=user_id,
        session_id="session-a",
        idempotency_key="upload-a",
    )
    missing_id = uuid4()

    with pytest.raises(AttachmentNotFound) as exc_info:
        await service.reference_attachments(
            project_id=project_id,
            session_id="session-a",
            attachment_ids=[ready.id, missing_id],
        )

    assert exc_info.value.attachment_id == missing_id


async def test_failure_after_object_write_leaves_pending_and_unfetchable(
    attachment_service,
):
    service, dao, store = attachment_service
    project_id = uuid4()
    user_id = uuid4()
    dao.fail_mark_ready = True

    with pytest.raises(RuntimeError, match="database unavailable"):
        await _create(
            service,
            project_id=project_id,
            user_id=user_id,
            session_id="session-a",
            idempotency_key="upload-a",
        )

    pending = dao.attachments[_store_key(project_id)]
    assert pending.state == AttachmentState.PENDING
    assert store.objects[(pending.mount_id, pending.path)] == b"hello"
    with pytest.raises(AttachmentNotFound):
        await service.fetch_attachment_content(
            project_id=project_id,
            session_id="session-a",
            attachment_id=pending.id,
        )


async def test_object_store_failure_frees_idempotency_key(attachment_service):
    service, dao, store = attachment_service
    project_id = uuid4()
    user_id = uuid4()
    store.fail_write = True

    with pytest.raises(RuntimeError, match="object store unavailable"):
        await _create(
            service,
            project_id=project_id,
            user_id=user_id,
            session_id="session-a",
            idempotency_key="upload-a",
        )

    assert _store_key(project_id) not in dao.attachments

    store.fail_write = False
    ready = await _create(
        service,
        project_id=project_id,
        user_id=user_id,
        session_id="session-a",
        idempotency_key="upload-a",
    )
    assert ready.state == AttachmentState.READY


async def test_quota_rejection_frees_key_and_object(attachment_service):
    service, dao, store = attachment_service
    project_id = uuid4()
    dao.reject_mark_ready_for_quota = True

    with pytest.raises(AttachmentQuotaExceeded):
        await _create(
            service,
            project_id=project_id,
            user_id=uuid4(),
            session_id="session-a",
            idempotency_key="upload-a",
        )

    assert _store_key(project_id) not in dao.attachments
    assert store.objects == {}


async def test_quota_rejection_keeps_the_row_pending_when_the_object_survives(
    attachment_service,
):
    service, dao, store = attachment_service
    project_id = uuid4()
    dao.reject_mark_ready_for_quota = True
    store.fail_delete = True

    with pytest.raises(AttachmentQuotaExceeded):
        await _create(
            service,
            project_id=project_id,
            user_id=uuid4(),
            session_id="session-a",
            idempotency_key="upload-a",
        )

    # Row and object stay paired so the pending sweep can reclaim both.
    pending = dao.attachments[_store_key(project_id)]
    assert pending.state == AttachmentState.PENDING
    assert store.objects[(pending.mount_id, pending.path)] == b"hello"


async def test_ready_idempotency_key_returns_same_attachment_without_second_write(
    attachment_service,
):
    service, _, store = attachment_service
    project_id = uuid4()
    user_id = uuid4()

    first = await _create(
        service,
        project_id=project_id,
        user_id=user_id,
        session_id="session-a",
        idempotency_key="upload-a",
    )
    retried = await _create(
        service,
        project_id=project_id,
        user_id=user_id,
        session_id="session-a",
        idempotency_key="upload-a",
    )

    assert retried.id == first.id
    assert store.write_count == 1


async def test_idempotency_key_with_different_bytes_conflicts(attachment_service):
    service, _, store = attachment_service
    project_id = uuid4()
    user_id = uuid4()
    await _create(
        service,
        project_id=project_id,
        user_id=user_id,
        session_id="session-a",
        idempotency_key="upload-a",
    )

    with pytest.raises(AttachmentConflict):
        await service.create_attachment(
            project_id=project_id,
            user_id=user_id,
            session_id="session-a",
            idempotency_key="upload-a",
            filename="note.txt",
            declared_media_type="text/plain",
            data=b"world",
        )

    assert store.write_count == 1


async def test_different_key_for_same_bytes_creates_second_attachment(
    attachment_service,
):
    service, _, store = attachment_service
    project_id = uuid4()
    user_id = uuid4()

    first = await _create(
        service,
        project_id=project_id,
        user_id=user_id,
        session_id="session-a",
        idempotency_key="upload-a",
    )
    second = await _create(
        service,
        project_id=project_id,
        user_id=user_id,
        session_id="session-a",
        idempotency_key="upload-b",
    )

    assert second.id != first.id
    assert len(store.objects) == 2


async def test_stale_pending_upload_is_taken_over_at_the_same_path(attachment_service):
    service, dao, store = attachment_service
    project_id = uuid4()
    user_id = uuid4()
    attachment_id = uuid4()
    stale = Attachment(
        id=attachment_id,
        project_id=project_id,
        session_id="session-a",
        mount_id=store.mount_id,
        path=f"{attachment_id}/note.txt",
        filename="note.txt",
        media_type="text/plain",
        size=5,
        kind=AttachmentKind.DOCUMENT,
        state=AttachmentState.PENDING,
        idempotency_key="upload-a",
        content_digest=sha256(b"hello").hexdigest(),
        created_at=datetime.now(timezone.utc) - timedelta(hours=1),
        created_by_id=user_id,
    )
    dao.attachments[_store_key(project_id)] = stale

    ready = await _create(
        service,
        project_id=project_id,
        user_id=user_id,
        session_id="session-a",
        idempotency_key="upload-a",
    )

    assert ready.id == stale.id
    assert ready.path == stale.path
    assert store.objects[(stale.mount_id, stale.path)] == b"hello"


def _router_for(service) -> SessionAttachmentsRouter:
    router = SessionAttachmentsRouter(attachments_service=service)
    router._check = AsyncMock()
    return router


async def test_router_requires_content_length_before_reading_form():
    service = AsyncMock()
    service.limits = AttachmentLimits()
    router = _router_for(service)

    with pytest.raises(HTTPException) as exc_info:
        await router.create_session_attachment(
            _upload_request(content_length=None),
            session_id="session-a",
        )

    assert exc_info.value.status_code == 411
    service.create_attachment.assert_not_awaited()


async def test_router_rejects_oversized_content_length_before_reading_form():
    service = AsyncMock()
    service.limits = AttachmentLimits()
    router = _router_for(service)
    oversized = service.limits.max_raw_bytes + _ATTACHMENT_MULTIPART_OVERHEAD_BYTES + 1

    with pytest.raises(HTTPException) as exc_info:
        await router.create_session_attachment(
            _upload_request(content_length=oversized),
            session_id="session-a",
        )

    assert exc_info.value.status_code == 413
    service.create_attachment.assert_not_awaited()


async def test_router_maps_mount_storage_unavailable_to_503():
    service = AsyncMock()
    service.limits = AttachmentLimits()
    service.create_attachment.side_effect = MountStorageUnavailable()
    router = _router_for(service)

    with pytest.raises(HTTPException) as exc_info:
        await router.create_session_attachment(
            _upload_request(),
            session_id="session-a",
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == MountStorageUnavailable().message


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (AttachmentConflict(), 409),
        (
            AttachmentUploadInFlight(
                attachment_id=uuid4(),
                retry_after_seconds=123,
            ),
            409,
        ),
    ],
)
async def test_router_maps_attachment_conflicts(error, expected_status):
    service = AsyncMock()
    service.limits = AttachmentLimits()
    service.create_attachment.side_effect = error
    router = _router_for(service)

    with pytest.raises(HTTPException) as exc_info:
        await router.create_session_attachment(
            _upload_request(),
            session_id="session-a",
        )

    assert exc_info.value.status_code == expected_status
    if isinstance(error, AttachmentUploadInFlight):
        assert exc_info.value.headers == {"Retry-After": "123"}


async def test_quota_rejection_maps_to_429_after_compensation(attachment_service):
    service, dao, store = attachment_service
    dao.reject_mark_ready_for_quota = True
    router = _router_for(service)
    request = _upload_request()

    with pytest.raises(HTTPException) as exc_info:
        await router.create_session_attachment(request, session_id="session-a")

    assert exc_info.value.status_code == 429
    assert _store_key(UUID(request.state.project_id)) not in dao.attachments
    assert store.objects == {}


async def test_router_rejects_an_oversized_idempotency_key_before_the_service():
    service = AsyncMock()
    service.limits = AttachmentLimits()
    router = _router_for(service)

    with pytest.raises(HTTPException) as exc_info:
        await router.create_session_attachment(
            _upload_request(
                idempotency_key="k" * (_MAX_IDEMPOTENCY_KEY_CHARACTERS + 1)
            ),
            session_id="session-a",
        )

    assert exc_info.value.status_code == 422
    service.create_attachment.assert_not_awaited()


async def test_router_accepts_an_idempotency_key_at_the_length_limit(
    attachment_service,
):
    service, _, _ = attachment_service
    router = _router_for(service)

    response = await router.create_session_attachment(
        _upload_request(idempotency_key="k" * _MAX_IDEMPOTENCY_KEY_CHARACTERS),
        session_id="session-a",
    )

    assert response.count == 1


async def test_router_checks_permissions_before_the_size_limits():
    service = AsyncMock()
    service.limits = AttachmentLimits()
    router = _router_for(service)
    router._check = AsyncMock(side_effect=HTTPException(status_code=403))

    with pytest.raises(HTTPException) as exc_info:
        await router.create_session_attachment(
            _upload_request(content_length=None),
            session_id="session-a",
        )

    # An unauthorized caller must not be able to probe the limits through 411/413.
    assert exc_info.value.status_code == 403


async def test_router_rejects_a_body_larger_than_its_declared_content_length():
    service = AsyncMock()
    limits = AttachmentLimits(
        max_image_bytes=16,
        max_audio_bytes=16,
        max_document_bytes=16,
        max_other_bytes=16,
    )
    service.limits = limits
    router = _router_for(service)

    with pytest.raises(HTTPException) as exc_info:
        await router.create_session_attachment(
            _upload_request(data=b"x" * 1024, content_length=8),
            session_id="session-a",
        )

    assert exc_info.value.status_code == 413
    service.create_attachment.assert_not_awaited()
