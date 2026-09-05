from datetime import datetime, timezone
from typing import Any, List, Optional
from uuid import UUID

import uuid_utils.compat as uuid
from sqlalchemy import (
    case,
    cast,
    delete as sa_delete,
    func,
    literal,
    or_,
    select,
    update as sa_update,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID, insert
from sqlalchemy.exc import IntegrityError

from oss.src.core.sessions.dtos import (
    SessionOrigin,
    SessionReference,
    SessionTriggerAttribution,
    SessionTriggerKind,
)
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamHeaderEdit,
    SessionStreamQuery,
    SessionStreamQueryResult,
    SessionStreamReadOptions,
)
from oss.src.core.sessions.streams.interfaces import (
    SessionStreamsDAOInterface,
    TriggerSessionClaimsDAOInterface,
)
from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists
from oss.src.core.shared.dtos import Status, Windowing
from oss.src.core.triggers.dtos import TRIGGER_DELIVERY_RETRYABLE_STATUS_CODE

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.dbs.postgres.sessions.references import (
    references_containment_json,
    references_to_json,
)
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.streams.mappings import (
    SESSION_ORIGIN_TAG_KEY,
    SESSION_TRIGGER_ID_TAG_KEY,
    SESSION_TRIGGER_KIND_TAG_KEY,
    trigger_attribution_tags,
    map_stream_dbe_to_dto,
    map_stream_query_result,
    map_stream_dto_to_dbe_create,
    map_stream_dto_to_dbe_edit,
    map_stream_dto_to_dbe_header_edit,
)

# The trigger claim lives in the sessions DAO, not triggers/dao.py (P2-13,
# accepted + documented per the ruling): the delivery INSERT and the session's
# attribution INSERT must land in one statement for atomicity — one committed
# session_streams row is what proves a delivery was claimed. Splitting them
# across two DAOs would need a second round-trip and reopen the race this
# claim exists to close. See claim_trigger_delivery below.
from oss.src.dbs.postgres.triggers.dbes import (
    TriggerDeliveryDBE,
    TriggerScheduleDBE,
    TriggerSubscriptionDBE,
)
from oss.src.dbs.postgres.triggers.upsert_utils import (
    build_trigger_delivery_conflict,
    build_trigger_delivery_values,
)

_UUID_PATTERN = (
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
    r"[0-9a-f]{4}-[0-9a-f]{12}$"
)

# Defense-in-depth clamp (P0-1): the API request model already bounds
# `windowing.limit` to [1, 200] with a 422, but this DAO is also reachable from
# internal callers that build a `Windowing` directly — never let one of those
# reach Postgres with an unbounded or negative `LIMIT`.
MAX_SESSION_QUERY_LIMIT = 200


class SessionStreamsDAO(SessionStreamsDAOInterface, TriggerSessionClaimsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def settle_command(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: Optional[str],
        mirror_stopped: bool,
        transaction: Optional[Any] = None,
    ) -> None:
        now = datetime.now(timezone.utc)
        values = {"stopping_turn_id": None, "updated_at": now}
        if mirror_stopped:
            values["flags"] = func.coalesce(SessionStreamDBE.flags, cast({}, JSONB)).op(
                "||"
            )(cast({"is_running": False}, JSONB))
        stmt = sa_update(SessionStreamDBE).where(
            SessionStreamDBE.project_id == project_id,
            SessionStreamDBE.session_id == session_id,
        )
        if turn_id is not None:
            stmt = stmt.where(
                or_(
                    SessionStreamDBE.stopping_turn_id == turn_id,
                    SessionStreamDBE.stopping_turn_id.is_(None),
                )
            )

        async def execute(session: Any) -> None:
            await session.execute(stmt.values(**values))

        if transaction is not None:
            await execute(transaction)
            return
        async with self.engine.session() as session:
            await execute(session)

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        stream: SessionStreamCreate,
    ) -> SessionStream:
        dbe = map_stream_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            stream=stream,
        )
        try:
            async with self.engine.session() as session:
                session.add(dbe)
                await session.commit()
                await session.refresh(dbe)
        except IntegrityError as e:
            error_str = str(e.orig) if e.orig else str(e)
            if "uq_session_streams_project_session_id" in error_str:
                raise SessionStreamAlreadyExists(session_id=stream.session_id) from e
            raise
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def claim_trigger_delivery(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        event_id: str,
        session_id: str,
        attribution: SessionTriggerAttribution,
    ) -> bool:
        by_schedule = attribution.kind == SessionTriggerKind.schedule
        claim_status = Status(code="102", message="claimed")
        delivery_values = {
            "id": attribution.delivery_id,
            "project_id": project_id,
            "created_by_id": user_id,
            "subscription_id": None if by_schedule else attribution.configuration_id,
            "schedule_id": attribution.configuration_id if by_schedule else None,
            "event_id": event_id,
            "status": claim_status.model_dump(mode="json", exclude_none=True),
            "data": {"session_id": session_id},
        }
        # Normalize/filter columns to the real table and reuse the shared conflict
        # target builder so all call sites stay in parity.
        delivery_values = build_trigger_delivery_values(delivery_values)
        index_elements, index_where = build_trigger_delivery_conflict(by_schedule)
        parent_dbe = TriggerScheduleDBE if by_schedule else TriggerSubscriptionDBE
        active_flags = (
            {"is_active": True}
            if by_schedule
            else {"is_active": True, "is_valid": True}
        )
        live_parent = (
            select(parent_dbe.id)
            .where(
                parent_dbe.project_id == project_id,
                parent_dbe.id == attribution.configuration_id,
                parent_dbe.deleted_at.is_(None),
                parent_dbe.flags.contains(active_flags),
            )
            .with_for_update()
            .cte("live_trigger_configuration")
        )
        delivery_columns = list(delivery_values)
        delivery_insert = insert(TriggerDeliveryDBE).from_select(
            delivery_columns,
            select(
                *(
                    literal(
                        delivery_values[column],
                        type_=TriggerDeliveryDBE.__table__.c[column].type,
                    )
                    for column in delivery_columns
                )
            ).select_from(live_parent),
        )
        claimed_delivery = (
            delivery_insert.on_conflict_do_update(
                index_elements=index_elements,
                index_where=index_where,
                # Retry re-claim (P1-8): a delivery stuck in the one retryable
                # terminal state (500 — the runner was unreachable, not a
                # permanent rejection) can be re-claimed by a fresh attempt.
                # Any other existing row (still claimed, or a terminal
                # non-retryable status) fails this WHERE and the row is left
                # untouched — the same outcome DO NOTHING gave for every case
                # except this one. `dedup_seen` gates on the identical status
                # check so a retry actually reaches this claim instead of
                # short-circuiting before it.
                where=TriggerDeliveryDBE.status["code"].astext
                == TRIGGER_DELIVERY_RETRYABLE_STATUS_CODE,
                set_={
                    "id": delivery_insert.excluded.id,
                    "created_by_id": delivery_insert.excluded.created_by_id,
                    "status": delivery_insert.excluded.status,
                    "data": delivery_insert.excluded.data,
                    "updated_at": datetime.now(timezone.utc),
                },
            )
            .returning(TriggerDeliveryDBE.id)
            .cte("claimed_trigger_delivery")
        )

        tags = trigger_attribution_tags(attribution)
        stream_insert = insert(SessionStreamDBE).from_select(
            ["id", "project_id", "created_by_id", "session_id", "tags"],
            select(
                literal(uuid.uuid7()),
                literal(project_id),
                literal(user_id),
                literal(session_id),
                cast(tags, JSONB),
            ).select_from(claimed_delivery),
        )
        merged_tags = func.coalesce(SessionStreamDBE.tags, cast({}, JSONB)).op("||")(
            stream_insert.excluded.tags
        )
        statement = stream_insert.on_conflict_do_update(
            index_elements=["project_id", "session_id"],
            set_={"tags": merged_tags},
        ).returning(SessionStreamDBE.id)

        async with self.engine.session() as session:
            try:
                result = await session.execute(statement)
                claimed = result.scalar_one_or_none() is not None
                await session.commit()
            except Exception:
                await session.rollback()
                raise

        return claimed

    async def abandon_claimed_session(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool:
        return await self.delete_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )

    async def get_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
        if dbe is None:
            return None
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def get_by_session_id_including_archived(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        """Like `get_by_session_id`, but also returns a soft-archived row — the
        confirmation read for `archive`/`unarchive` (S7/F2, WP5)."""
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
        if dbe is None:
            return None
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def get_by_id(
        self,
        *,
        project_id: UUID,
        stream_id: UUID,
    ) -> Optional[SessionStream]:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.id == stream_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
        if dbe is None:
            return None
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    @staticmethod
    def _apply_filters(
        stmt,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
        session_ids: Optional[List[str]] = None,
        exclude_session_ids: Optional[List[str]] = None,
    ):
        """Shared row predicate for `query` and `count` — one definition, so a filtered
        page and its total can never disagree."""
        stmt = stmt.where(SessionStreamDBE.project_id == project_id)
        if not filter.include_ended:
            stmt = stmt.where(SessionStreamDBE.deleted_at.is_(None))
        if filter.archived_only:
            stmt = stmt.where(SessionStreamDBE.archived_at.is_not(None))
        elif not filter.include_archived:
            stmt = stmt.where(SessionStreamDBE.archived_at.is_(None))
        if filter.session_id is not None:
            stmt = stmt.where(SessionStreamDBE.session_id == filter.session_id)
        if session_ids is not None:
            stmt = stmt.where(SessionStreamDBE.session_id.in_(session_ids))
        # Empty exclusions would render an always-true `NOT IN ()`; skip instead.
        if exclude_session_ids:
            stmt = stmt.where(SessionStreamDBE.session_id.not_in(exclude_session_ids))
        if filter.flags is not None:
            flags_filter = filter.flags.model_dump(
                exclude_none=True, exclude_unset=True
            )
            if flags_filter:
                stmt = stmt.where(SessionStreamDBE.flags.contains(flags_filter))
        origin = SessionStreamDBE.tags[SESSION_ORIGIN_TAG_KEY].astext
        if filter.origins is not None:
            origin_values = [value.value for value in filter.origins]
            if SessionOrigin.manual.value in origin_values:
                # Nothing has ever stamped "manual" — every human session has a NULL
                # origin (only `trigger_attribution_tags` writes the tag, and only
                # ever "trigger"). Admit NULL when "manual" is requested, or
                # `origins: ["manual"]` matches zero rows and
                # `origins: ["manual", "trigger"]` silently drops every human
                # session (P1-1).
                stmt = stmt.where(or_(origin.in_(origin_values), origin.is_(None)))
            else:
                stmt = stmt.where(origin.in_(origin_values))
        if filter.exclude_origins:
            stmt = stmt.where(
                or_(
                    origin.is_(None),
                    origin.not_in([value.value for value in filter.exclude_origins]),
                )
            )
        term = filter.search.strip() if filter.search else ""
        if term:
            # Escape LIKE metacharacters so a literal `%`/`_` in the search term
            # doesn't act as a wildcard.
            escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            stmt = stmt.where(SessionStreamDBE.name.ilike(f"%{escaped}%", escape="\\"))
        return stmt

    async def count(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
        session_ids: Optional[List[str]] = None,
        exclude_session_ids: Optional[List[str]] = None,
    ) -> int:
        """Total rows matching the filter, ignoring windowing — the number a filter chip
        shows. Deliberately separate from `query` so a page fetch pays for it only when a
        caller asks."""
        async with self.engine.session() as session:
            stmt = self._apply_filters(
                select(func.count()).select_from(SessionStreamDBE),
                project_id=project_id,
                filter=filter,
                session_ids=session_ids,
                exclude_session_ids=exclude_session_ids,
            )
            result = await session.execute(stmt)
        return int(result.scalar_one() or 0)

    async def query(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
        windowing: Optional[Windowing] = None,
        session_ids: Optional[List[str]] = None,
        exclude_session_ids: Optional[List[str]] = None,
        read_options: Optional[SessionStreamReadOptions] = None,
    ) -> List[SessionStreamQueryResult]:
        read_options = read_options or SessionStreamReadOptions()
        async with self.engine.session() as session:
            stmt = self._query_select(read_options=read_options)
            stmt = self._apply_filters(
                stmt,
                project_id=project_id,
                filter=filter,
                session_ids=session_ids,
                exclude_session_ids=exclude_session_ids,
            )
            if windowing:
                if windowing.limit is not None:
                    windowing = windowing.model_copy(
                        update={
                            "limit": min(
                                max(windowing.limit, 1), MAX_SESSION_QUERY_LIMIT
                            )
                        }
                    )
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=SessionStreamDBE,
                    # Last-activity ordering: updated_at is fed by heartbeat/edit/archive,
                    # so a resumed session bumps to the top instead of sorting by its
                    # original (uuid7) creation time. The coalesce(updated_at, created_at)
                    # expression can't use the (project_id, created_at)/archived_at indexes
                    # (no expression index for it), but per-project session-list sizes keep
                    # the in-memory sort acceptable — a deliberate choice, not an oversight.
                    attribute="updated_at",
                    order="descending",
                    windowing=windowing,
                )
            else:
                # No windowing here means this is the liveness-index caller
                # (`query_session_streams`), not the paginated session list — ordering
                # isn't load-bearing there, but keep it consistent with the windowed path,
                # coalescing onto created_at for rows never touched since creation (same
                # rationale as `apply_windowing`'s updated_at branch).
                stmt = stmt.order_by(
                    func.coalesce(
                        SessionStreamDBE.updated_at, SessionStreamDBE.created_at
                    ).desc(),
                    SessionStreamDBE.id.desc(),
                )
            result = await session.execute(stmt)
            if read_options.include_trigger_details:
                rows = result.all()
                return [
                    map_stream_query_result(
                        stream_dbe=row[0], trigger_name=row.trigger_name
                    )
                    for row in rows
                ]
            dbes = result.scalars().all()
            return [map_stream_query_result(stream_dbe=dbe) for dbe in dbes]

    @staticmethod
    def _query_select(*, read_options: SessionStreamReadOptions):
        if not read_options.include_trigger_details:
            return select(SessionStreamDBE)

        trigger_id_text = SessionStreamDBE.tags[SESSION_TRIGGER_ID_TAG_KEY].astext
        trigger_kind = SessionStreamDBE.tags[SESSION_TRIGGER_KIND_TAG_KEY].astext
        trigger_id = case(
            (
                trigger_id_text.op("~*")(_UUID_PATTERN),
                cast(trigger_id_text, PG_UUID(as_uuid=True)),
            ),
            else_=None,
        )
        trigger_name = case(
            (
                trigger_kind == SessionTriggerKind.schedule.value,
                TriggerScheduleDBE.name,
            ),
            (
                trigger_kind == SessionTriggerKind.subscription.value,
                TriggerSubscriptionDBE.name,
            ),
            else_=None,
        ).label("trigger_name")

        return (
            select(SessionStreamDBE, trigger_name)
            .outerjoin(
                TriggerScheduleDBE,
                (TriggerScheduleDBE.project_id == SessionStreamDBE.project_id)
                & (trigger_kind == SessionTriggerKind.schedule.value)
                & (TriggerScheduleDBE.id == trigger_id),
            )
            .outerjoin(
                TriggerSubscriptionDBE,
                (TriggerSubscriptionDBE.project_id == SessionStreamDBE.project_id)
                & (trigger_kind == SessionTriggerKind.subscription.value)
                & (TriggerSubscriptionDBE.id == trigger_id),
            )
        )

    async def update(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        stream: SessionStreamEdit,
    ) -> Optional[SessionStream]:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return None
            map_stream_dto_to_dbe_edit(
                stream_dbe=dbe,
                user_id=user_id,
                stream=stream,
            )
            dbe.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(dbe)
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def query_session_ids_by_references(
        self,
        *,
        project_id: UUID,
        references: List[SessionReference],
        limit: int,
    ) -> List[str]:
        """Sessions whose OWN references satisfy the filter — the turns query's twin.

        Unioned with the turns result rather than replacing it: a session whose turn
        append was dropped is findable only through this column, and one that predates
        the column only through the turns.
        """
        containment = references_containment_json(references)
        if containment is None:
            return []
        async with self.engine.session() as session:
            # No DISTINCT needed — (project_id, session_id) is unique here — which is what
            # lets the cap order by last activity, the same expression the list itself
            # sorts by, so a capped filter keeps the rows a user would see first.
            stmt = (
                select(SessionStreamDBE.session_id)
                .where(
                    SessionStreamDBE.project_id == project_id,
                    SessionStreamDBE.references.contains(containment),
                )
                .order_by(
                    func.coalesce(
                        SessionStreamDBE.updated_at, SessionStreamDBE.created_at
                    ).desc()
                )
                .limit(limit)
            )
            result = await session.execute(stmt)
            return [row[0] for row in result.all()]

    async def fill_missing(
        self,
        *,
        project_id: UUID,
        session_id: str,
        name: Optional[str] = None,
        references: Optional[List[SessionReference]] = None,
    ) -> bool:
        """Write `name` / `references` onto the row ONLY where it still holds NULL.

        One COALESCE'd UPDATE rather than a read-then-write: a rename landing between a
        read and a write would otherwise be silently overwritten by a heartbeat's
        proposal, which is exactly what fill-once must never do. Returns whether a row
        was touched. `updated_at` is deliberately not bumped — the flag mirror owns it,
        and a fill is not activity.

        An empty proposal (``""`` / ``[]``) means nothing to say, not something to store.
        A row gets exactly one fill per column, so writing a blank title or an empty list
        would spend it and make the real value arriving on a later beat un-writable.
        Callers normalize too; this is what makes the DAO safe on its own.
        """
        values = {}
        guards = []
        if name:
            values["name"] = func.coalesce(SessionStreamDBE.name, name)
            guards.append(SessionStreamDBE.name.is_(None))
        if references:
            values["references"] = func.coalesce(
                SessionStreamDBE.references,
                cast(references_to_json(references), JSONB),
            )
            guards.append(SessionStreamDBE.references.is_(None))
        if not values:
            return False

        async with self.engine.session() as session:
            stmt = (
                sa_update(SessionStreamDBE)
                .where(
                    SessionStreamDBE.project_id == project_id,
                    SessionStreamDBE.session_id == session_id,
                    SessionStreamDBE.deleted_at.is_(None),
                    or_(*guards),
                )
                .values(**values)
            )
            result = await session.execute(stmt)
            await session.commit()
        return bool(result.rowcount)

    async def update_header(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        header: SessionStreamHeaderEdit,
    ) -> Optional[SessionStream]:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return None
            map_stream_dto_to_dbe_header_edit(
                stream_dbe=dbe,
                user_id=user_id,
                header=header,
            )
            # `updated_at` is deliberately not bumped: it is the last-ACTIVITY sort key, and
            # renaming a session is not activity — bumping it teleports the row you just
            # renamed to the top of every session list.
            await session.commit()
            await session.refresh(dbe)
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def mark_history_incomplete(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> int:
        if not session_ids:
            return 0

        async with self.engine.session() as session:
            stmt = (
                sa_update(SessionStreamDBE)
                .where(
                    SessionStreamDBE.project_id == project_id,
                    SessionStreamDBE.session_id.in_(session_ids),
                    SessionStreamDBE.history_incomplete.is_not(True),
                )
                .values(history_incomplete=True)
            )
            result = await session.execute(stmt)
            await session.commit()
        return int(result.rowcount)

    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
                SessionStreamDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return False
            dbe.deleted_at = datetime.now(timezone.utc)
            await session.commit()
        return True

    async def unarchive_by_session_id(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]:
        """Clear `deleted_at` on the stream row — the reverse of the archive
        fan-out's `delete_by_session_id` soft-delete (S7/F2, WP5)."""
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return None
            dbe.deleted_at = None
            dbe.updated_by_id = user_id
            dbe.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(dbe)
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def set_archived_by_session_id(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]:
        """Set `archived_at` — hide the session from the default list (restorable). Orthogonal to
        `deleted_at` (kill): an ended session can still be archived, and the query filters the two
        states independently."""
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return None
            dbe.archived_at = datetime.now(timezone.utc)
            dbe.updated_by_id = user_id
            dbe.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(dbe)
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def clear_archived_by_session_id(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]:
        """Clear `archived_at` — restore an archived session to the list (reverse of archive)."""
        async with self.engine.session() as session:
            stmt = select(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return None
            dbe.archived_at = None
            dbe.updated_by_id = user_id
            dbe.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(dbe)
        return map_stream_dbe_to_dto(stream_dbe=dbe)

    async def hard_delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool:
        """Hard delete the merged stream row — `kill`/`delete_by_session_id` only
        soft-delete; this is new plumbing for the session-scoped hard-delete
        fan-out (S7/F1, WP5)."""
        async with self.engine.session() as session:
            stmt = sa_delete(SessionStreamDBE).where(
                SessionStreamDBE.project_id == project_id,
                SessionStreamDBE.session_id == session_id,
            )
            result = await session.execute(stmt)
            await session.commit()
            return bool(result.rowcount)

    async def count_active(
        self,
        *,
        project_id: Optional[UUID] = None,
    ) -> int:
        """Count running streams (for concurrency cap check)."""
        async with self.engine.session() as session:
            stmt = (
                select(func.count())
                .select_from(SessionStreamDBE)
                .where(
                    SessionStreamDBE.deleted_at.is_(None),
                    SessionStreamDBE.flags.contains({"is_running": True}),
                )
            )
            if project_id is not None:
                stmt = stmt.where(SessionStreamDBE.project_id == project_id)
            result = await session.execute(stmt)
            return result.scalar_one()
