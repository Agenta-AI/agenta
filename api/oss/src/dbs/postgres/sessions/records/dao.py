from typing import Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID

from sqlalchemy import case, func, or_, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from oss.src.core.sessions.records.dtos import (
    RECORD_SETTLED_BY_ATTRIBUTE,
    SESSION_MESSAGE_PREVIEW_TEXT_LIMIT,
    TERMINAL_RECORD_TYPE,
    SessionMessagePreview,
    SessionRecord,
    SessionRecordEvent,
    SessionRecordsPage,
    SessionRecordsReplay,
    SessionRecordsReadState,
)
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.dbs.postgres.sessions.records.dbes import (
    RecordDBE,
    SessionSequenceCursorDBE,
)
from oss.src.dbs.postgres.sessions.records.mappings import (
    map_record_event_to_dbe,
    map_record_dbe_to_dto,
)
from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_analytics_engine
from oss.src.utils.env import env


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
        values = RecordsDAO._values(event=event)
        if env.sessions.sequence_writes:
            return await RecordsDAO._append_sequenced(values=values, session=session)

        stmt = RecordsDAO._upsert_stmt(values_list=[values])
        result = await session.execute(stmt)
        await session.flush()

        row = result.scalars().first()
        if row is None:
            return None
        return map_record_dbe_to_dto(dbe=row)

    @staticmethod
    async def _append_sequenced(
        *,
        values: dict,
        session: AsyncSession,
    ) -> Optional[SessionRecord]:
        insert_stmt = (
            insert(RecordDBE)
            .values(values)
            .on_conflict_do_nothing(index_elements=["project_id", "record_id"])
            .returning(RecordDBE.record_id)
        )
        inserted_id = (await session.execute(insert_stmt)).scalar_one_or_none()
        if inserted_id is None:
            result = await session.execute(
                RecordsDAO._upsert_stmt(values_list=[values])
            )
            await session.flush()
            row = result.scalars().first()
            return map_record_dbe_to_dto(dbe=row) if row is not None else None

        cursor_insert = insert(SessionSequenceCursorDBE).values(
            project_id=values["project_id"],
            session_id=values["session_id"],
            latest_sequence=1,
        )
        cursor_stmt = cursor_insert.on_conflict_do_update(
            index_elements=["project_id", "session_id"],
            set_={
                "latest_sequence": SessionSequenceCursorDBE.latest_sequence + 1,
                "updated_at": func.now(),
            },
        ).returning(SessionSequenceCursorDBE.latest_sequence)
        sequence = (await session.execute(cursor_stmt)).scalar_one()
        record_stmt = (
            update(RecordDBE)
            .where(
                RecordDBE.project_id == values["project_id"],
                RecordDBE.record_id == values["record_id"],
            )
            .values(sequence=sequence)
            .returning(RecordDBE)
        )
        row = (await session.execute(record_stmt)).scalars().one()
        await session.flush()
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
            if env.sessions.sequence_writes:
                records = []
                for values in values_list:
                    record = await self._append_sequenced(
                        values=values, session=session
                    )
                    if record is not None:
                        records.append(record)
                await session.commit()
                return records

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
        "quarantined_at",
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
                # coalesce, not a plain overwrite: quarantine is one-way. A redelivery of a
                # late record keeps the instant it was FIRST quarantined, so the column is
                # stable however many times the stream replays the message, and a delivery
                # that somehow arrives unmarked can never resurrect the row into the
                # transcript.
                "quarantined_at": func.coalesce(
                    RecordDBE.quarantined_at, stmt.excluded.quarantined_at
                ),
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
                    # A quarantined record is history the platform refused: it reached ingest
                    # for a turn the watchdog had already ended. Excluding it HERE is what
                    # makes one execution render one ending, because this is the read every
                    # transcript reconstruction goes through.
                    RecordDBE.quarantined_at.is_(None),
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

    @staticmethod
    def _transcript_order():
        return (
            case((RecordDBE.sequence.is_(None), 0), else_=1),
            case((RecordDBE.sequence.is_(None), RecordDBE.timestamp), else_=None)
            .asc()
            .nullslast(),
            case((RecordDBE.sequence.is_(None), RecordDBE.created_at), else_=None)
            .asc()
            .nullslast(),
            case((RecordDBE.sequence.is_(None), RecordDBE.record_index), else_=None)
            .asc()
            .nullslast(),
            RecordDBE.sequence.asc().nullslast(),
        )

    async def get_records_page(
        self,
        *,
        project_id: UUID,
        session_id: str,
        offset: int,
        limit: int,
        through_sequence: int,
    ) -> SessionRecordsPage:
        async with self.engine.session() as session:
            stmt = (
                select(RecordDBE)
                .where(
                    RecordDBE.project_id == project_id,
                    RecordDBE.session_id == session_id,
                    RecordDBE.deleted_at.is_(None),
                    or_(
                        RecordDBE.sequence.is_(None),
                        RecordDBE.sequence <= through_sequence,
                    ),
                )
                .order_by(*self._transcript_order())
                .offset(offset)
                .limit(limit + 1)
            )
            rows = list((await session.execute(stmt)).scalars().all())

        has_more = len(rows) > limit
        records = [map_record_dbe_to_dto(dbe=row) for row in rows[:limit]]
        return SessionRecordsPage(
            records=records,
            offset=offset,
            limit=limit,
            next_offset=offset + limit if has_more else None,
            through_sequence=through_sequence,
        )

    async def get_read_state(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> SessionRecordsReadState:
        async with self.engine.session() as session:
            latest_sequence = await session.scalar(
                select(SessionSequenceCursorDBE.latest_sequence).where(
                    SessionSequenceCursorDBE.project_id == project_id,
                    SessionSequenceCursorDBE.session_id == session_id,
                )
            )
            record_count, first_sequenced_at = (
                await session.execute(
                    select(
                        func.count(RecordDBE.record_id),
                        func.min(RecordDBE.created_at).filter(
                            RecordDBE.sequence.is_not(None)
                        ),
                    ).where(
                        RecordDBE.project_id == project_id,
                        RecordDBE.session_id == session_id,
                        RecordDBE.deleted_at.is_(None),
                    )
                )
            ).one()
            null_after_cutover = False
            if first_sequenced_at is not None:
                null_after_cutover = bool(
                    await session.scalar(
                        select(func.count(RecordDBE.record_id)).where(
                            RecordDBE.project_id == project_id,
                            RecordDBE.session_id == session_id,
                            RecordDBE.deleted_at.is_(None),
                            RecordDBE.sequence.is_(None),
                            RecordDBE.created_at >= first_sequenced_at,
                        )
                    )
                )

        history_complete = record_count == 0 or (
            latest_sequence is not None and not null_after_cutover
        )
        return SessionRecordsReadState(
            latest_sequence=latest_sequence or 0,
            history_complete=history_complete,
        )

    async def get_records_after(
        self,
        *,
        project_id: UUID,
        session_id: str,
        after: int,
    ) -> SessionRecordsReplay:
        async with self.engine.session() as session:
            watermark = (
                await session.scalar(
                    select(SessionSequenceCursorDBE.latest_sequence).where(
                        SessionSequenceCursorDBE.project_id == project_id,
                        SessionSequenceCursorDBE.session_id == session_id,
                    )
                )
                or 0
            )
            sequence_filter = (
                or_(
                    RecordDBE.sequence.is_(None),
                    RecordDBE.sequence.between(1, watermark),
                )
                if after == 0
                else RecordDBE.sequence.between(after + 1, watermark)
            )
            rows = list(
                (
                    await session.execute(
                        select(RecordDBE)
                        .where(
                            RecordDBE.project_id == project_id,
                            RecordDBE.session_id == session_id,
                            RecordDBE.deleted_at.is_(None),
                            sequence_filter,
                        )
                        .order_by(*self._transcript_order())
                    )
                )
                .scalars()
                .all()
            )
        return SessionRecordsReplay(
            records=[map_record_dbe_to_dto(dbe=row) for row in rows],
            watermark=watermark,
        )

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
                    RecordDBE.quarantined_at.is_(None),
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
        settled_by: Optional[str] = None,
    ) -> Set[Tuple[str, str]]:
        """Which of these `(session_id, turn_id)` pairs already carry a terminal record.

        Two callers ask nearly the same question and mean different things by it, which is
        why `settled_by` exists rather than a second query.

        * The watchdog asks with no writer, before it writes an ending of its own: ANY
          terminal record means this turn already ended and must not be given a second,
          contradictory one.
        * The ingest guard asks with `settled_by="watchdog"`, and only the watchdog's own
          ending counts. A runner that wrote its honest ending has not lost the turn to the
          platform, so nothing arriving afterwards is late in the sense that matters.

        A QUARANTINED terminal record never answers yes to either. It is precisely the
        second, refused ending both callers exist to keep out of the transcript, so counting
        it would let one late `done` suppress the real one.

        One query for the whole batch, served by
        `ix_records_project_id_session_id_turn_id`.
        """
        if not keys:
            return set()

        conditions = [
            RecordDBE.project_id == project_id,
            RecordDBE.record_type == TERMINAL_RECORD_TYPE,
            RecordDBE.deleted_at.is_(None),
            RecordDBE.quarantined_at.is_(None),
            tuple_(RecordDBE.session_id, RecordDBE.turn_id).in_(
                [(session_id, turn_id) for session_id, turn_id in keys]
            ),
        ]
        if settled_by is not None:
            conditions.append(
                RecordDBE.attributes[RECORD_SETTLED_BY_ATTRIBUTE].astext == settled_by
            )

        async with self.engine.session() as session:
            stmt = (
                select(RecordDBE.session_id, RecordDBE.turn_id)
                .where(*conditions)
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
