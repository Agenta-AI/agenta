from typing import Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID

from sqlalchemy import func, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from oss.src.core.sessions.records.dtos import (
    SESSION_MESSAGE_PREVIEW_TEXT_LIMIT,
    SessionMessagePreview,
    SessionRecord,
    SessionRecordEvent,
)
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.dbs.postgres.sessions.records.dbes import RecordDBE
from oss.src.dbs.postgres.sessions.records.mappings import (
    map_record_event_to_dbe,
    map_record_dbe_to_dto,
)
from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_analytics_engine

# The runner's terminal per-turn record type. Mirrored in
# oss/src/tasks/asyncio/sessions/records_worker.py, which reads the same marker off the
# ingest stream; both come from services/runner/src/protocol.ts (`{ type: "done" }`).
TERMINAL_RECORD_TYPE = "done"


class RecordsDAO(RecordsDAOInterface):
    def __init__(self, engine: AnalyticsEngine = None):
        if engine is None:
            engine = get_analytics_engine()
        self.engine = engine

    async def append(
        self,
        *,
        event: SessionRecordEvent,
        session: Optional[AsyncSession] = None,
    ) -> Optional[SessionRecord]:
        if session is None:
            async with self.engine.session() as session:
                result = await self._append(event=event, session=session)
                await session.commit()
                return result

        return await self._append(event=event, session=session)

    @staticmethod
    async def _append(
        *,
        event: SessionRecordEvent,
        session: AsyncSession,
    ) -> Optional[SessionRecord]:
        stmt = RecordsDAO._upsert_stmt(values_list=[RecordsDAO._values(event=event)])
        result = await session.execute(stmt)
        await session.flush()

        row = result.scalars().first()
        if row is None:
            return None
        return map_record_dbe_to_dto(dbe=row)

    async def append_many(
        self,
        *,
        events: List[SessionRecordEvent],
    ) -> List[SessionRecord]:
        """Upsert all events via one batched statement in one session, not one
        connection (or one round trip) per event."""
        if not events:
            return []

        values_list = self._dedupe_values(
            values_list=[self._values(event=event) for event in events]
        )

        async with self.engine.session() as session:
            stmt = self._upsert_stmt(values_list=values_list)
            result = await session.execute(stmt)
            await session.commit()

            return [map_record_dbe_to_dto(dbe=row) for row in result.scalars().all()]

    @staticmethod
    def _values(*, event: SessionRecordEvent) -> dict:
        dbe = map_record_event_to_dbe(event=event)
        return {
            c.name: getattr(dbe, c.name)
            for c in RecordDBE.__table__.columns
            if not (getattr(dbe, c.name) is None and c.server_default is not None)
        }

    # Columns the upsert overwrites on conflict; every other column keeps the first
    # occurrence's value, exactly as ON CONFLICT DO UPDATE would.
    _UPSERT_UPDATED_COLUMNS = (
        "record_type",
        "record_source",
        "timestamp",
        "attributes",
        "turn_id",
        "span_id",
    )

    @staticmethod
    def _dedupe_values(*, values_list: List[dict]) -> List[dict]:
        # Postgres rejects one INSERT ... ON CONFLICT DO UPDATE that touches the same
        # (project_id, record_id) twice ("cannot affect row a second time"), and the
        # runner legitimately re-sends a record_id within a flush window (partial
        # tool_call frame, then the completed one). Collapse duplicates into the end
        # state sequential per-event upserts would have produced.
        deduped: dict = {}
        for values in values_list:
            key = (values["project_id"], values["record_id"])
            prev = deduped.get(key)
            if prev is None:
                deduped[key] = values
            else:
                deduped[key] = {
                    **prev,
                    **{
                        column: values[column]
                        for column in RecordsDAO._UPSERT_UPDATED_COLUMNS
                        if column in values
                    },
                }
        return list(deduped.values())

    @staticmethod
    def _upsert_stmt(*, values_list: List[dict]):
        stmt = insert(RecordDBE).values(values_list)
        return stmt.on_conflict_do_update(
            index_elements=["project_id", "record_id"],
            set_={
                "record_type": stmt.excluded.record_type,
                "record_source": stmt.excluded.record_source,
                "timestamp": stmt.excluded.timestamp,
                "attributes": stmt.excluded.attributes,
                "turn_id": stmt.excluded.turn_id,
                "span_id": stmt.excluded.span_id,
            },
        ).returning(RecordDBE)

    async def get_records(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[SessionRecord]:
        async with self.engine.session() as session:
            stmt = (
                select(RecordDBE)
                .where(
                    RecordDBE.project_id == project_id,
                    RecordDBE.session_id == session_id,
                )
                # Producer event time first: it is the only key that is monotonic across
                # turns. `record_index` restarts at 0 every turn, and the worker can batch
                # records from two turns into one write so they share `created_at` — the old
                # (created_at, record_index) order then sorted the NEXT turn's first record
                # ahead of the PREVIOUS turn's later ones, interleaving the conversation.
                # Rows written before `timestamp` existed sort last within their ingest batch.
                .order_by(
                    RecordDBE.timestamp.asc().nullslast(),
                    RecordDBE.created_at.asc(),
                    RecordDBE.record_index.asc(),
                )
            )

            dbes = (await session.execute(stmt)).scalars().all()
            return [map_record_dbe_to_dto(dbe=dbe) for dbe in dbes]

    async def latest_message_per_session(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> Dict[str, SessionMessagePreview]:
        """The newest `message` record for each of `session_ids`, in ONE query.

        `DISTINCT ON` rather than a per-session fetch: a list page asks for up to fifty
        previews at once, and fifty round-trips per render is not a preview, it is a fan-out.
        Ordering mirrors `get_records` reversed — producer event time is the only key that is
        monotonic across turns (`record_index` restarts every turn).
        """
        if not session_ids:
            return {}

        async with self.engine.session() as session:
            # Select the truncated text expression, not the whole `attributes` JSONB —
            # a 5 MB last message otherwise rides along for every row on every page
            # (P2-1). `left(...)` truncates before the value ever leaves Postgres.
            preview_text = func.left(
                RecordDBE.attributes["text"].astext, SESSION_MESSAGE_PREVIEW_TEXT_LIMIT
            ).label("text")
            stmt = (
                select(
                    RecordDBE.session_id,
                    RecordDBE.record_source,
                    preview_text,
                    RecordDBE.timestamp,
                    RecordDBE.created_at,
                )
                .where(
                    RecordDBE.project_id == project_id,
                    RecordDBE.session_id.in_(session_ids),
                    RecordDBE.record_type == "message",
                    RecordDBE.deleted_at.is_(None),
                )
                .distinct(RecordDBE.session_id)
                .order_by(
                    RecordDBE.session_id,
                    RecordDBE.timestamp.desc().nullslast(),
                    RecordDBE.created_at.desc(),
                    RecordDBE.record_index.desc(),
                )
            )

            rows = (await session.execute(stmt)).all()

        previews: Dict[str, SessionMessagePreview] = {}
        for row in rows:
            text = row.text
            # A message whose payload carries no text (attachment-only) has nothing to preview.
            if not isinstance(text, str) or not text.strip():
                continue
            previews[row.session_id] = SessionMessagePreview(
                text=text.strip(),
                source=row.record_source,
                timestamp=row.timestamp or row.created_at,
            )
        return previews

    async def settled_turns(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
    ) -> Set[Tuple[str, str]]:
        """Which of these `(session_id, turn_id)` pairs already carry a terminal record.

        The watchdog asks this before it writes one of its own, so a turn whose runner DID
        report an outcome is never given a second, contradictory ending. One query for the
        whole batch, served by `ix_records_project_id_session_id_turn_id`.
        """
        if not keys:
            return set()

        async with self.engine.session() as session:
            stmt = (
                select(RecordDBE.session_id, RecordDBE.turn_id)
                .where(
                    RecordDBE.project_id == project_id,
                    RecordDBE.record_type == TERMINAL_RECORD_TYPE,
                    RecordDBE.deleted_at.is_(None),
                    tuple_(RecordDBE.session_id, RecordDBE.turn_id).in_(
                        [(session_id, turn_id) for session_id, turn_id in keys]
                    ),
                )
                .distinct()
            )
            rows = (await session.execute(stmt)).all()

        return {(row.session_id, row.turn_id) for row in rows}

    async def get_event(
        self,
        *,
        project_id: UUID,
        record_id: UUID,
    ) -> Optional[SessionRecord]:
        async with self.engine.session() as session:
            stmt = select(RecordDBE).where(
                RecordDBE.project_id == project_id,
                RecordDBE.record_id == record_id,
            )

            dbe = (await session.execute(stmt)).scalars().first()
            if dbe is None:
                return None
            return map_record_dbe_to_dto(dbe=dbe)
