from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, func, or_, select, text, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from oss.src.core.sessions.attachments.dtos import (
    Attachment,
    AttachmentCreate,
    AttachmentLimits,
    AttachmentQuotaUsage,
    AttachmentReferenceResult,
    AttachmentReservation,
    AttachmentReservationStatus,
    AttachmentState,
)
from oss.src.core.sessions.attachments.interfaces import (
    AttachmentOriginalDelete,
    SessionAttachmentsDAOInterface,
)
from oss.src.core.sessions.attachments.types import (
    enforce_attachment_quota,
    enforce_stored_attachment_quota,
)
from oss.src.dbs.postgres.sessions.attachments.dbes import SessionAttachmentDBE
from oss.src.dbs.postgres.sessions.attachments.mappings import (
    map_attachment_create_to_dbe,
    map_attachment_dbe_to_dto,
    refresh_pending_takeover,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


class SessionAttachmentsDAO(SessionAttachmentsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        self.engine = engine or get_transactions_engine()

    async def fetch_by_idempotency_key(
        self,
        *,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
    ) -> Optional[Attachment]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(SessionAttachmentDBE).where(
                    SessionAttachmentDBE.project_id == project_id,
                    SessionAttachmentDBE.session_id == session_id,
                    SessionAttachmentDBE.idempotency_key == idempotency_key,
                )
            )
            attachment_dbe = result.scalar_one_or_none()
        if attachment_dbe is None:
            return None
        return map_attachment_dbe_to_dto(attachment_dbe=attachment_dbe)

    async def get_quota_usage(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> AttachmentQuotaUsage:
        async with self.engine.session() as session:
            return await self._get_quota_usage(
                session=session,
                project_id=project_id,
                session_id=session_id,
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
        now = datetime.now(timezone.utc)
        async with self.engine.session() as session:
            await self._lock_session_scope(
                session=session,
                project_id=project_id,
                session_id=attachment_create.session_id,
            )
            existing = await self._fetch_idempotency_locked(
                session=session,
                project_id=project_id,
                session_id=attachment_create.session_id,
                idempotency_key=attachment_create.idempotency_key,
            )
            if existing is not None:
                reservation = self._existing_reservation(
                    attachment_dbe=existing,
                    attachment_create=attachment_create,
                    user_id=user_id,
                    now=now,
                    stale_before=stale_before,
                )
                await session.commit()
                await session.refresh(existing)
                return reservation.model_copy(
                    update={
                        "attachment": map_attachment_dbe_to_dto(attachment_dbe=existing)
                    }
                )

            usage = await self._get_quota_usage(
                session=session,
                project_id=project_id,
                session_id=attachment_create.session_id,
            )
            enforce_attachment_quota(
                usage=usage,
                limits=limits,
                incoming_size=attachment_create.size,
            )
            attachment_dbe = map_attachment_create_to_dbe(
                project_id=project_id,
                user_id=user_id,
                attachment_create=attachment_create,
            )
            session.add(attachment_dbe)
            await session.commit()
            await session.refresh(attachment_dbe)
            return AttachmentReservation(
                attachment=map_attachment_dbe_to_dto(attachment_dbe=attachment_dbe),
                status=AttachmentReservationStatus.CREATED,
            )

    async def mark_ready(
        self,
        *,
        project_id: UUID,
        attachment_id: UUID,
        limits: AttachmentLimits,
    ) -> Optional[Attachment]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(SessionAttachmentDBE.session_id).where(
                    SessionAttachmentDBE.project_id == project_id,
                    SessionAttachmentDBE.id == attachment_id,
                )
            )
            session_id = result.scalar_one_or_none()
            if session_id is None:
                return None

            await self._lock_session_scope(
                session=session,
                project_id=project_id,
                session_id=session_id,
            )
            result = await session.execute(
                select(SessionAttachmentDBE)
                .where(
                    SessionAttachmentDBE.project_id == project_id,
                    SessionAttachmentDBE.id == attachment_id,
                    SessionAttachmentDBE.state == AttachmentState.PENDING.value,
                )
                .with_for_update()
            )
            attachment_dbe = result.scalar_one_or_none()
            if attachment_dbe is None:
                return None

            usage = await self._get_quota_usage(
                session=session,
                project_id=project_id,
                session_id=session_id,
            )
            # Quota enforcement lives here because the session advisory lock lives here.
            enforce_stored_attachment_quota(
                usage=usage,
                limits=limits,
                incoming_size=attachment_dbe.size,
            )
            attachment_dbe.state = AttachmentState.READY.value
            attachment_dbe.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(attachment_dbe)
        return map_attachment_dbe_to_dto(attachment_dbe=attachment_dbe)

    async def delete_pending(
        self,
        *,
        project_id: UUID,
        attachment_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            result = await session.execute(
                delete(SessionAttachmentDBE)
                .where(
                    SessionAttachmentDBE.project_id == project_id,
                    SessionAttachmentDBE.id == attachment_id,
                    SessionAttachmentDBE.state == AttachmentState.PENDING.value,
                )
                .returning(SessionAttachmentDBE.id)
            )
            deleted_id = result.scalar_one_or_none()
            await session.commit()
        return deleted_id is not None

    async def fetch_ready(
        self,
        *,
        project_id: UUID,
        session_id: str,
        attachment_id: UUID,
    ) -> Optional[Attachment]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(SessionAttachmentDBE).where(
                    SessionAttachmentDBE.project_id == project_id,
                    SessionAttachmentDBE.session_id == session_id,
                    SessionAttachmentDBE.id == attachment_id,
                    SessionAttachmentDBE.state == AttachmentState.READY.value,
                )
            )
            attachment_dbe = result.scalar_one_or_none()
        if attachment_dbe is None:
            return None
        return map_attachment_dbe_to_dto(attachment_dbe=attachment_dbe)

    async def reference_ready(
        self,
        *,
        project_id: UUID,
        session_id: str,
        attachment_ids: List[UUID],
        referenced_at: datetime,
    ) -> AttachmentReferenceResult:
        ordered_ids = list(dict.fromkeys(attachment_ids))
        if not ordered_ids:
            return AttachmentReferenceResult()

        async with self.engine.session() as session:
            result = await session.execute(
                select(SessionAttachmentDBE)
                .where(
                    SessionAttachmentDBE.project_id == project_id,
                    SessionAttachmentDBE.session_id == session_id,
                    SessionAttachmentDBE.id.in_(ordered_ids),
                    SessionAttachmentDBE.state == AttachmentState.READY.value,
                )
                .with_for_update()
            )
            attachment_dbes = list(result.scalars().all())
            resolved_ids = {attachment_dbe.id for attachment_dbe in attachment_dbes}
            missing_ids = [
                attachment_id
                for attachment_id in ordered_ids
                if attachment_id not in resolved_ids
            ]
            # The claim is all-or-nothing: leave every row untouched when one id is unresolved.
            if missing_ids:
                return AttachmentReferenceResult(missing_ids=missing_ids)

            for attachment_dbe in attachment_dbes:
                if attachment_dbe.referenced_at is None:
                    attachment_dbe.referenced_at = referenced_at
                    attachment_dbe.updated_at = referenced_at
            await session.commit()
            for attachment_dbe in attachment_dbes:
                await session.refresh(attachment_dbe)

        by_id = {
            attachment_dbe.id: map_attachment_dbe_to_dto(attachment_dbe=attachment_dbe)
            for attachment_dbe in attachment_dbes
        }
        return AttachmentReferenceResult(
            attachments=[by_id[attachment_id] for attachment_id in ordered_ids]
        )

    async def reap_stale_pending(
        self,
        *,
        older_than: datetime,
        delete_original: AttachmentOriginalDelete,
        limit: int = 100,
    ) -> List[Attachment]:
        return await self._delete_stale(
            state=AttachmentState.PENDING,
            older_than=older_than,
            delete_original=delete_original,
            limit=limit,
        )

    async def sweep_unreferenced_ready(
        self,
        *,
        older_than: datetime,
        delete_original: AttachmentOriginalDelete,
        limit: int = 100,
    ) -> List[Attachment]:
        return await self._delete_stale(
            state=AttachmentState.READY,
            older_than=older_than,
            delete_original=delete_original,
            limit=limit,
        )

    @staticmethod
    async def _lock_session_scope(
        *,
        session: AsyncSession,
        project_id: UUID,
        session_id: str,
    ) -> None:
        await session.execute(
            text(
                "SELECT pg_advisory_xact_lock(hashtextextended(:attachment_scope, 0))"
            ),
            {"attachment_scope": (f"session-attachments:{project_id}:{session_id}")},
        )

    @staticmethod
    async def _get_quota_usage(
        *,
        session: AsyncSession,
        project_id: UUID,
        session_id: str,
    ) -> AttachmentQuotaUsage:
        stored = await session.execute(
            select(
                func.count(SessionAttachmentDBE.id),
                func.coalesce(func.sum(SessionAttachmentDBE.size), 0),
            ).where(
                SessionAttachmentDBE.project_id == project_id,
                SessionAttachmentDBE.session_id == session_id,
                or_(
                    SessionAttachmentDBE.state == AttachmentState.READY.value,
                    SessionAttachmentDBE.referenced_at.is_not(None),
                ),
            )
        )
        stored_count, stored_bytes = stored.one()
        pending = await session.execute(
            select(func.count(SessionAttachmentDBE.id)).where(
                SessionAttachmentDBE.project_id == project_id,
                SessionAttachmentDBE.session_id == session_id,
                SessionAttachmentDBE.state == AttachmentState.PENDING.value,
            )
        )
        return AttachmentQuotaUsage(
            stored_count=stored_count,
            stored_bytes=stored_bytes,
            pending_count=pending.scalar_one(),
        )

    @staticmethod
    async def _fetch_idempotency_locked(
        *,
        session: AsyncSession,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
    ) -> Optional[SessionAttachmentDBE]:
        result = await session.execute(
            select(SessionAttachmentDBE)
            .where(
                SessionAttachmentDBE.project_id == project_id,
                SessionAttachmentDBE.session_id == session_id,
                SessionAttachmentDBE.idempotency_key == idempotency_key,
            )
            .with_for_update()
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _existing_reservation(
        *,
        attachment_dbe: SessionAttachmentDBE,
        attachment_create: AttachmentCreate,
        user_id: UUID,
        now: datetime,
        stale_before: datetime,
    ) -> AttachmentReservation:
        attachment = map_attachment_dbe_to_dto(attachment_dbe=attachment_dbe)
        if not SessionAttachmentsDAO._same_upload(
            attachment=attachment,
            attachment_create=attachment_create,
        ):
            status = AttachmentReservationStatus.CONFLICT
        elif attachment.state == AttachmentState.READY:
            status = AttachmentReservationStatus.READY
        elif attachment.state == AttachmentState.DELETING:
            status = AttachmentReservationStatus.IN_FLIGHT
        elif attachment.created_at is None or attachment.created_at >= stale_before:
            status = AttachmentReservationStatus.IN_FLIGHT
        else:
            refresh_pending_takeover(
                attachment_dbe=attachment_dbe,
                user_id=user_id,
                now=now,
            )
            status = AttachmentReservationStatus.TAKEN_OVER
        return AttachmentReservation(attachment=attachment, status=status)

    @staticmethod
    def _same_upload(
        *,
        attachment: Attachment,
        attachment_create: AttachmentCreate,
    ) -> bool:
        return (
            attachment.filename == attachment_create.filename
            and attachment.media_type == attachment_create.media_type
            and attachment.size == attachment_create.size
            and attachment.content_digest == attachment_create.content_digest
        )

    async def _delete_stale(
        self,
        *,
        state: AttachmentState,
        older_than: datetime,
        delete_original: AttachmentOriginalDelete,
        limit: int,
    ) -> List[Attachment]:
        now = datetime.now(timezone.utc)
        async with self.engine.session() as session:
            states = [state.value]
            if state == AttachmentState.PENDING:
                states.append(AttachmentState.DELETING.value)
            conditions = [
                SessionAttachmentDBE.state.in_(states),
                SessionAttachmentDBE.created_at < older_than,
            ]
            if state == AttachmentState.READY:
                conditions.append(SessionAttachmentDBE.referenced_at.is_(None))
            result = await session.execute(
                select(SessionAttachmentDBE)
                .where(*conditions)
                .order_by(SessionAttachmentDBE.created_at.asc())
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            attachment_dbes = list(result.scalars().all())
            candidates: List[Attachment] = []
            for attachment_dbe in attachment_dbes:
                candidates.append(
                    map_attachment_dbe_to_dto(attachment_dbe=attachment_dbe)
                )
                # Tombstoning first makes claims fail closed; failed object deletes stay retryable.
                attachment_dbe.state = AttachmentState.DELETING.value
                attachment_dbe.updated_at = now
            await session.commit()

        cleaned: List[Attachment] = []
        for attachment in candidates:
            try:
                await delete_original(attachment)
            except Exception:
                log.error(
                    "attachment_sweep: object deletion failed for %s",
                    attachment.id,
                    exc_info=True,
                )
            else:
                cleaned.append(attachment)

        if not cleaned:
            return []

        coordinates = [(attachment.project_id, attachment.id) for attachment in cleaned]
        async with self.engine.session() as session:
            result = await session.execute(
                select(SessionAttachmentDBE)
                .where(
                    tuple_(
                        SessionAttachmentDBE.project_id,
                        SessionAttachmentDBE.id,
                    ).in_(coordinates),
                    SessionAttachmentDBE.state == AttachmentState.DELETING.value,
                )
                .with_for_update(skip_locked=True)
            )
            deleted_coordinates = set()
            for attachment_dbe in result.scalars().all():
                deleted_coordinates.add((attachment_dbe.project_id, attachment_dbe.id))
                await session.delete(attachment_dbe)
            await session.commit()

        return [
            attachment
            for attachment in cleaned
            if (attachment.project_id, attachment.id) in deleted_coordinates
        ]
