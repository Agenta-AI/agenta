from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.sessions.records.dtos import (
    SessionMessagePreview,
    SessionRecord,
    SessionRecordEvent,
    SessionRecordsAppendResult,
)
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.core.sessions.records.types import RecordContentConflict
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


class RecordsService:
    def __init__(
        self,
        records_dao: RecordsDAOInterface,
        streams_dao: Optional[SessionStreamsDAOInterface] = None,
    ):
        self.records_dao = records_dao
        self.streams_dao = streams_dao

    async def append(
        self,
        *,
        event: SessionRecordEvent,
        session: Optional[Any] = None,
    ) -> Optional[SessionRecord]:
        try:
            return await self.records_dao.append(event=event, session=session)
        except RecordContentConflict as exc:
            self._log_conflicts(
                events=[event],
                record_ids=[detail.record_id for detail in exc.conflicts],
                exc=exc,
            )
            raise

    async def append_many(
        self,
        *,
        events: List[SessionRecordEvent],
    ) -> SessionRecordsAppendResult:
        result = await self.records_dao.append_many(events=events)
        if result.conflicting_record_ids:
            self._log_conflicts(
                events=events,
                record_ids=result.conflicting_record_ids,
            )
        return result

    @staticmethod
    def _log_conflicts(
        *,
        events: List[SessionRecordEvent],
        record_ids: List[Optional[UUID]],
        exc: Optional[RecordContentConflict] = None,
    ) -> None:
        event_by_id = {
            event.record_id or event.producer_id: event
            for event in events
            if event.record_id or event.producer_id
        }
        details_by_id = {
            detail.record_id: detail for detail in (exc.conflicts if exc else [])
        }
        for record_id in record_ids:
            if record_id is None:
                continue
            event = event_by_id.get(record_id)
            detail = details_by_id.get(record_id)
            if event is None and detail is None:
                continue
            log.error(
                "[RECORDS] Rejected stable-id retry with different content",
                project_id=str(
                    event.project_id if event is not None else detail.project_id
                ),
                session_id=(
                    event.session_id if event is not None else detail.session_id
                ),
                record_id=str(record_id),
            )

    async def mark_history_incomplete(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> int:
        if self.streams_dao is None:
            return 0
        return await self.streams_dao.mark_history_incomplete(
            project_id=project_id,
            session_ids=session_ids,
        )

    async def get_records(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[SessionRecord]:
        return await self.records_dao.get_records(
            project_id=project_id,
            session_id=session_id,
        )

    async def get_event(
        self,
        *,
        project_id: UUID,
        record_id: UUID,
    ) -> Optional[SessionRecord]:
        return await self.records_dao.get_event(
            project_id=project_id,
            record_id=record_id,
        )

    async def latest_message_per_session(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> Dict[str, SessionMessagePreview]:
        """One batched lookup for a whole page — never one call per row."""
        if not session_ids:
            return {}

        return await self.records_dao.latest_message_per_session(
            project_id=project_id,
            session_ids=session_ids,
        )
