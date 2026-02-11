from typing import Tuple, Any, Dict, Optional, List, Literal, cast as type_cast
from uuid import UUID
from traceback import format_exc
from datetime import datetime, timezone

from sqlalchemy import cast, func, select, text
from sqlalchemy.types import Numeric, BigInteger
from sqlalchemy.sql import Select, and_, or_
from sqlalchemy.exc import DBAPIError
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.dialects.postgresql import BIT

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.shared.dtos import Windowing
from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelFlatSpan,
    TracingQuery,
    Focus,
    Bucket,
    Filtering,
    MetricSpec,
    MetricsBucket,
    Condition,
    ListOperator,
)

from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.tracing.dbes import SpanDBE
from oss.src.dbs.postgres.tracing.mappings import (
    map_span_dbe_to_link_dto,
    map_span_dto_to_span_dbe,
    map_span_dbe_to_span_dto,
    map_buckets,
)
from oss.src.dbs.postgres.tracing.utils import (
    TIMEOUT_STMT,
    #
    combine,
    filter,
    #
    parse_windowing,
    build_specs_values,
    build_base_cte,
    build_extract_cte,
    build_type_flags,
    build_statistics_stmt,
    #
    compute_range,
    parse_pcts,
    compute_iqrs,
    compute_cqvs,
    compute_pscs,
    normalize_hist,
    parse_bin_freq,
    normalize_freq,
    compute_uniq,
)


log = get_module_logger(__name__)


class TracingDAO(TracingDAOInterface):
    def __init__(self):
        pass

    ### SPANS

    @suppress_exceptions(default=[])
    async def ingest(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        """Ingest spans using PostgreSQL INSERT ... ON CONFLICT ... DO UPDATE."""
        if not span_dtos:
            return []

        async with engine.tracing_session() as session:
            link_dtos: List[OTelLink] = []

            for span_dto in span_dtos:
                span_dbe = map_span_dto_to_span_dbe(
                    project_id=project_id,
                    user_id=user_id,
                    span_dto=span_dto,
                )

                # PostgreSQL upsert: INSERT ... ON CONFLICT ... DO UPDATE
                values = {
                    c.name: getattr(span_dbe, c.name) for c in SpanDBE.__table__.columns
                }

                stmt = insert(SpanDBE).values(**values)

                # On conflict on primary key (project_id, trace_id, span_id), update all fields
                update_fields = {
                    c.name: stmt.excluded[c.name]
                    for c in SpanDBE.__table__.columns
                    if c.name
                    not in [
                        "project_id",
                        "trace_id",
                        "span_id",
                        "created_at",
                        "created_by_id",
                    ]
                }
                update_fields["updated_at"] = datetime.now(timezone.utc)
                update_fields["updated_by_id"] = user_id

                stmt = stmt.on_conflict_do_update(
                    index_elements=["project_id", "trace_id", "span_id"],
                    set_=update_fields,
                )

                await session.execute(stmt)

                link_dto = map_span_dbe_to_link_dto(span_dbe=span_dbe)
                link_dtos.append(link_dto)

            await session.commit()

            return link_dtos

    @suppress_exceptions(default=[])
    async def query(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,  # type: ignore
    ) -> List[OTelFlatSpan]:
        # DE-STRUCTURING
        focus = query.formatting.focus if query.formatting else None

        oldest = query.windowing.oldest if query.windowing else None
        newest = query.windowing.newest if query.windowing else None
        next = query.windowing.next if query.windowing else None
        limit = query.windowing.limit if query.windowing else None
        rate = query.windowing.rate if query.windowing else None

        operator = query.filtering.operator if query.filtering else None
        conditions = query.filtering.conditions if query.filtering else None
        # --------------

        # DEBUGGING
        # log.trace(query.model_dump(mode="json", exclude_none=True))
        # ---------

        try:
            async with engine.tracing_session() as session:
                # TIMEOUT
                await session.execute(TIMEOUT_STMT)
                # -------

                # BASE (SUB-)STMT
                base: Select = select(SpanDBE)
                # ---------------

                # GROUPING
                if focus == Focus.TRACE:
                    base = select(
                        SpanDBE.trace_id,
                        SpanDBE.start_time,
                    ).distinct(SpanDBE.trace_id)
                # --------

                # SCOPING
                base = base.filter(SpanDBE.project_id == project_id)
                # -------

                # FILTERING
                if operator and conditions:
                    base = base.filter(
                        type_cast(
                            ColumnElement[bool],
                            combine(
                                operator=operator,
                                clauses=filter(conditions),
                            ),
                        )
                    )
                # ---------

                # WINDOWING
                if rate is not None:
                    percent = max(0, min(int(rate * 100.0), 100))

                    if percent == 0:
                        return []

                    if percent < 100:
                        base = base.where(
                            cast(
                                text("concat('x', left(cast(trace_id as varchar), 8))"),
                                BIT(32),
                            ).cast(BigInteger)
                            % 100
                            < percent
                        )
                # ---------

                # GROUPING
                if focus == Focus.TRACE:
                    # WINDOWING
                    if newest:
                        if next:
                            base = base.filter(SpanDBE.start_time <= newest)
                        else:
                            base = base.filter(SpanDBE.start_time < newest)
                    if oldest:
                        base = base.filter(SpanDBE.start_time >= oldest)
                    # ---------

                    base = base.order_by(SpanDBE.trace_id, SpanDBE.start_time.desc())

                    inner = base.subquery("latest_per_trace")

                    uniq = select(inner.c.trace_id)

                    uniq = uniq.order_by(inner.c.start_time.desc())

                    if next and newest:
                        uniq = uniq.filter(
                            or_(
                                inner.c.start_time < newest,
                                and_(
                                    inner.c.start_time == newest,
                                    inner.c.trace_id < next,
                                ),
                            )
                        )

                    if limit:
                        uniq = uniq.limit(limit)

                    stmt = (
                        select(SpanDBE)
                        .filter(SpanDBE.trace_id.in_(uniq))
                        .order_by(
                            func.max(SpanDBE.start_time)
                            .over(partition_by=SpanDBE.trace_id)
                            .desc(),
                            SpanDBE.start_time.asc(),
                        )
                    )
                else:
                    if query.windowing:
                        stmt = apply_windowing(
                            stmt=base,
                            DBE=SpanDBE,
                            attribute="start_time",
                            order="descending",
                            windowing=query.windowing,
                        )
                    else:
                        stmt = base
                # --------

                # DEBUGGING
                # log.trace(str(stmt.compile(**DEBUG_ARGS)).replace("\n", " "))
                # ---------

                # EXECUTION
                dbes = (await session.execute(stmt)).scalars().all()
                # ---------

                if not dbes:
                    return []

                span_dtos = [map_span_dbe_to_span_dto(span_dbe=dbe) for dbe in dbes]

                return span_dtos

        except DBAPIError as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())

            if "QueryCanceledError" in str(e.orig):
                raise Exception(  # pylint: disable=broad-exception-raised
                    "TracingQuery execution was cancelled due to timeout. "
                    "Please try again with a smaller time interval."
                ) from e

            raise e

        except Exception as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())
            raise e

    @suppress_exceptions(default=[])
    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        specs: List[MetricSpec],
    ) -> List[MetricsBucket]:
        # DEBUGGING
        # log.trace(query.model_dump(mode="json", exclude_none=True))
        # log.trace([s.model_dump(mode="json", exclude_none=True) for s in specs])
        # ---------

        if not query.windowing:
            query.windowing = Windowing()

        if not query.filtering:
            query.filtering = Filtering()

        (
            oldest,
            newest,
            stride,
            interval,
            timestamps,
        ) = parse_windowing(
            windowing=query.windowing,
        )

        if query.windowing.rate is not None:
            percent = max(0, min(int(query.windowing.rate * 100.0), 100))
            if percent == 0:
                return []

        # log.info(f"[TRACING] [analytics] processing {len(specs)} specs")
        # for idx, spec in enumerate(specs):
        #     log.info(
        #         f"[TRACING] [analytics] spec[{idx}]: type={spec.type}, path={spec.path}"
        #     )

        metric_specs: Dict[int, MetricSpec] = {
            idx: MetricSpec(
                **s.model_dump(exclude={"path"}),
                path=s.path.removeprefix("attributes."),  # path prefix removal
            )
            for idx, s in enumerate(specs)
        }

        # log.info(
        #     f"[TRACING] [analytics] metric_specs after prefix removal: {[(idx, spec.path) for idx, spec in metric_specs.items()]}"
        # )

        type_flags = build_type_flags(
            metric_specs=list(metric_specs.values()),
        )

        if type_flags is None:
            log.warning("[TRACING] [analytics] no type flags found from specs")
            return []

        # log.info(f"[TRACING] [analytics] type_flags built successfully")

        specs_values = build_specs_values(
            metric_specs=list(metric_specs.values()),
        )

        if specs_values is None:
            log.warning("[TRACING] [analytics] no specs values found from metric specs")
            return []

        # log.info(f"[TRACING] [analytics] specs_values: {specs_values}")

        base_cte = build_base_cte(
            project_id=project_id,
            #
            oldest=oldest,
            newest=newest,
            stride=stride,
            rate=query.windowing.rate,
            #
            filtering=query.filtering,
        )

        if base_cte is None:
            log.warning("[TRACING] [analytics] no base CTE found from filtering")
            return []

        # log.info(f"[TRACING] [analytics] base CTE built")

        extract_cte = build_extract_cte(
            base_cte=base_cte,
            specs_values=specs_values,
        )

        if extract_cte is None:
            log.warning("[TRACING] [analytics] no extract CTE found")
            return []

        # log.info(f"[TRACING] [analytics] extract CTE built")

        statistics_stmt = build_statistics_stmt(
            extract_cte=extract_cte,
            type_flags=type_flags,
        )

        if statistics_stmt is None:
            log.warning("[TRACING] [analytics] no statistics CTE found")
            return []

        # DEBUGGING
        # log.trace(str(statistics_stmt.compile(**DEBUG_ARGS)).replace("\n", " "))
        # ---------

        async with engine.tracing_session() as session:
            await session.execute(TIMEOUT_STMT)

            rows = (await session.execute(select(statistics_stmt))).mappings().all()

        rows = [{**row} for row in rows]

        for r in rows:
            kind: str = r["kind"]
            value: Dict[str, Any] = dict()

            if kind == "cont_count":
                value = r["value"] or {}
            elif kind == "cont_basics":
                value = r["value"] or {}
                value = compute_range(value)
            elif kind == "cont_pcts":
                value = {}
                value = parse_pcts(r["value"] or [])
                value = compute_iqrs(value)
                value = compute_cqvs(value)
                value = compute_pscs(value)
            elif kind == "cont_hist":
                value = normalize_hist(r["value"] or [])

            elif kind == "disc_count":
                value = r["value"] or {}
            elif kind == "disc_basics":
                value = r["value"] or {}
                value = compute_range(value)
            elif kind == "disc_pcts":
                value = {}
                value = parse_pcts(r["value"] or [])
                value = compute_iqrs(value)
                value = compute_cqvs(value)
                value = compute_pscs(value)
            elif kind == "disc_freq":
                value = normalize_freq(r["value"] or [])
                value = compute_uniq(value)

            elif kind == "cls_count":
                value = r["value"] or {}
            elif kind == "cls_freq":
                value = normalize_freq(r["value"] or [])
                value = compute_uniq(value)

            elif kind == "lbl_count":
                value = r["value"] or {}
            elif kind == "lbl_freq":
                value = normalize_freq(r["value"] or [])
                value = compute_uniq(value)

            elif kind == "bin_count":
                value = r["value"] or {}
            elif kind == "bin_freq":
                value = r["value"] or {}
                value = normalize_freq(parse_bin_freq(value))
                value = compute_uniq(value)

            elif kind == "str_count":
                value = r["value"] or {}

            elif kind == "json_count":
                value = r["value"] or {}

            r["value"] = value

        per_timestamp: Dict[datetime, Dict[str, Dict[str, Any]]] = dict()

        for r in rows:
            _timestamp: datetime = r["timestamp"]
            _idx: int = r["idx"]

            if _idx > len(metric_specs):
                continue

            _spec = metric_specs.get(_idx)

            if not _spec:
                continue

            _path = "attributes." + _spec.path  # revert path prefix removal
            _type = _spec.type

            if _timestamp not in per_timestamp:
                per_timestamp[_timestamp] = dict()

            if _path not in per_timestamp[_timestamp]:
                per_timestamp[_timestamp][_path] = dict(type=_type.value)

            per_timestamp[_timestamp][_path] = (
                per_timestamp[_timestamp][_path] | r["value"]
            )

        buckets: List[MetricsBucket] = []

        for timestamp, metrics in per_timestamp.items():
            bucket = MetricsBucket(
                timestamp=timestamp,
                interval=interval,
                metrics=metrics,
            )
            buckets.append(bucket)

        # DEBUGGING
        # log.trace([b.model_dump(mode="json", exclude_none=True) for b in buckets])
        # ---------

        return buckets

    @suppress_exceptions(default=[])
    async def legacy_analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
    ) -> List[Bucket]:
        # DEBUGGING
        # log.trace(query.model_dump(mode="json", exclude_none=True))
        # ---------

        (
            oldest,
            newest,
            stride,
            interval,
            timestamps,
        ) = parse_windowing(query.windowing)

        try:
            async with engine.tracing_session() as session:
                await session.execute(TIMEOUT_STMT)

                # BASE QUERY HELPERS
                _count = func.count().label("count")  # pylint: disable=not-callable
                _duration = None
                _costs = None
                _tokens = None
                _timestamp = func.date_bin(
                    text(f"'{stride}'"),
                    SpanDBE.created_at,
                    oldest,
                ).label("timestamp")
                # ------------------

                # GROUPING
                inc_or_cum = (
                    "cumulative"
                    if query.formatting and query.formatting.focus == Focus.TRACE
                    else "incremental"
                )

                _duration = func.sum(
                    cast(
                        SpanDBE.attributes["ag"]["metrics"]["duration"][
                            "cumulative"
                        ].astext,
                        Numeric,
                    )
                ).label("duration")

                _costs = func.sum(
                    cast(
                        SpanDBE.attributes["ag"]["metrics"]["costs"][inc_or_cum][
                            "total"
                        ].astext,
                        Numeric,
                    )
                ).label("costs")

                _tokens = func.sum(
                    cast(
                        SpanDBE.attributes["ag"]["metrics"]["tokens"][inc_or_cum][
                            "total"
                        ].astext,
                        Numeric,
                    )
                ).label("tokens")
                # --------

                # BASE QUERY
                total_stmt = select(
                    _count,
                    _duration,
                    _costs,
                    _tokens,
                    _timestamp,
                ).select_from(SpanDBE)

                errors_stmt = select(
                    _count,
                    _duration,
                    _costs,
                    _tokens,
                    _timestamp,
                ).select_from(SpanDBE)
                # ----------

                # WINDOWING
                total_stmt = total_stmt.filter(
                    SpanDBE.created_at >= oldest,
                    SpanDBE.created_at < newest,
                )

                errors_stmt = errors_stmt.filter(
                    SpanDBE.created_at >= oldest,
                    SpanDBE.created_at < newest,
                )
                # ---------

                # SCOPING
                total_stmt = total_stmt.filter_by(
                    project_id=project_id,
                )

                errors_stmt = errors_stmt.filter_by(
                    project_id=project_id,
                )
                # -------

                # TOTAL vs ERRORS
                # ----------------

                # FILTERING
                # ---------
                if query.filtering:
                    operator = query.filtering.operator
                    conditions = query.filtering.conditions

                    total_stmt = total_stmt.filter(
                        type_cast(
                            ColumnElement[bool],
                            combine(
                                operator=operator,
                                clauses=filter(conditions),
                            ),
                        )
                    )

                    errors_stmt = errors_stmt.filter(
                        type_cast(
                            ColumnElement[bool],
                            combine(
                                operator=operator,
                                clauses=filter(
                                    conditions
                                    + [
                                        Condition(
                                            field="events",
                                            operator=ListOperator.IN,
                                            value=[{"name": "exception"}],
                                        )
                                    ]
                                ),
                            ),
                        )
                    )
                # ---------

                # GROUPING
                if query.formatting and query.formatting.focus == Focus.TRACE:
                    total_stmt = total_stmt.filter_by(
                        parent_id=None,
                    )

                    errors_stmt = errors_stmt.filter_by(
                        parent_id=None,
                    )
                # --------

                # SORTING
                total_stmt = total_stmt.group_by("timestamp")

                errors_stmt = errors_stmt.group_by("timestamp")
                # -------

                # DEBUGGING
                # log.trace(str(total_stmt.compile(**DEBUG_ARGS)).replace("\n", " "))
                # log.trace(str(errors_stmt.compile(**DEBUG_ARGS)).replace("\n", " "))
                # ---------

                # QUERY EXECUTION
                total_buckets = list((await session.execute(total_stmt)).all())
                errors_buckets = list((await session.execute(errors_stmt)).all())
                # ---------------

                buckets = map_buckets(
                    total_buckets=total_buckets,
                    errors_buckets=errors_buckets,
                    interval=interval,
                    timestamps=timestamps,
                )

                # DEBUGGING
                # log.trace(
                #     [b.model_dump(mode="json", exclude_none=True) for b in buckets]
                # )
                # ---------

            return buckets

        except DBAPIError as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())

            if "AnalyticsCanceledError" in str(e.orig):
                raise Exception(  # pylint: disable=broad-exception-raised
                    "Analytics execution was cancelled due to timeout. "
                    "Please try again with a smaller time interval."
                ) from e

            raise e

        except Exception as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())
            raise e

    ### TRACES

    @suppress_exceptions(default=[])
    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        """Fetch all spans for the given trace IDs."""
        if not trace_ids:
            return []

        async with engine.tracing_session() as session:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id.in_(trace_ids),
            )

            stmt = stmt.order_by(SpanDBE.start_time.asc())

            result = await session.execute(stmt)

            span_dbes = result.scalars().all()

            if not span_dbes:
                return []

            span_dtos = [
                map_span_dbe_to_span_dto(
                    span_dbe=span_dbe,
                )
                for span_dbe in span_dbes
            ]

            return span_dtos

    @suppress_exceptions(default=[])
    async def delete(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelLink]:
        """Delete all spans for the given trace IDs."""
        if not trace_ids:
            return []

        async with engine.tracing_session() as session:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id.in_(trace_ids),
            )

            result = await session.execute(stmt)

            span_dbes = result.scalars().all()

            if not span_dbes:
                return []

            link_dtos = [
                map_span_dbe_to_link_dto(
                    span_dbe=span_dbe,
                )
                for span_dbe in span_dbes
            ]

            for span_dbe in span_dbes:
                await session.delete(span_dbe)

            await session.commit()

            return link_dtos

    ### SESSIONS AND USERS

    @suppress_exceptions(default=([], None))
    async def sessions(
        self,
        *,
        project_id: UUID,
        #
        realtime: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        """Query unique session IDs with windowing support."""
        return await self._query_by_group(
            project_id=project_id,
            #
            realtime=realtime,
            #
            windowing=windowing,
            #
            group="session",
        )

    @suppress_exceptions(default=([], None))
    async def users(
        self,
        *,
        project_id: UUID,
        #
        realtime: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        """Query unique user IDs with windowing support."""
        return await self._query_by_group(
            project_id=project_id,
            #
            realtime=realtime,
            #
            windowing=windowing,
            #
            group="user",
        )

    async def _query_by_group(
        self,
        *,
        project_id: UUID,
        #
        group: Literal["session", "user"],
        #
        realtime: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        """Query unique session or user IDs with windowing support.

        Args:
            group: Either "session" or "user"
            realtime: If True, use last_active (mutable, shows recent activity but unstable cursors).
                     If False/None, use first_active (immutable, stable cursors but doesn't reflect new activity).
        """
        async with engine.tracing_session() as session:
            # TIMEOUT
            await session.execute(TIMEOUT_STMT)

            # Determine ordering direction from windowing parameter
            # Default to descending (most recent first) if not specified
            order_direction = "descending"
            if windowing and windowing.order:
                order_direction = windowing.order.lower()

            # BASE QUERY: Use DISTINCT ON pattern (like query() does for traces)
            # DISTINCT ON picks one row per identifier based on ORDER BY
            id_column = SpanDBE.attributes["ag"][group]["id"].as_string()
            base = (
                select(
                    id_column.label(f"{group}_id"),
                    SpanDBE.start_time,
                )
                .distinct(id_column)
                .filter(SpanDBE.project_id == project_id)
                .filter(SpanDBE.attributes["ag"][group].has_key("id"))
            )

            # Apply time-range filters on base query (before deduplication)
            # Follows apply_windowing() logic for oldest/newest based on order direction
            if windowing:
                if order_direction == "ascending":
                    # ASC: Moving forward in time
                    if windowing.newest:
                        base = base.filter(SpanDBE.start_time <= windowing.newest)
                    if windowing.oldest:
                        if windowing.next:
                            base = base.filter(SpanDBE.start_time >= windowing.oldest)
                        else:
                            base = base.filter(SpanDBE.start_time > windowing.oldest)
                else:
                    # DESC: Moving backward in time
                    if windowing.newest:
                        if windowing.next:
                            base = base.filter(SpanDBE.start_time <= windowing.newest)
                        else:
                            base = base.filter(SpanDBE.start_time < windowing.newest)
                    if windowing.oldest:
                        base = base.filter(SpanDBE.start_time >= windowing.oldest)

            # ORDER BY for DISTINCT ON: identifier first, then start_time
            # This determines which row to pick per identifier
            # realtime=True: pick latest (mutable), realtime=False/None: pick earliest (stable)
            if realtime:
                # Realtime mode: Pick latest activity (unstable but shows recent activity)
                base = base.order_by(
                    id_column,
                    SpanDBE.start_time.desc(),
                )
            else:
                # Stable mode: Pick earliest activity (stable cursor)
                base = base.order_by(
                    id_column,
                    SpanDBE.start_time.asc(),
                )

            # Create subquery (like query() does with inner/uniq pattern)
            inner = base.subquery(f"unique_{group}s")

            # Build final query that orders and limits the unique identifiers
            # Label depends on realtime mode
            activity_label = "last_active" if realtime else "first_active"
            uniq = select(
                getattr(inner.c, f"{group}_id").label(f"{group}_id"),
                inner.c.start_time.label(activity_label),
            )

            # Order the unique identifiers by their activity time
            # (regardless of realtime mode, order by the picked timestamp)
            if order_direction == "ascending":
                uniq = uniq.order_by(inner.c.start_time.asc())
            else:
                uniq = uniq.order_by(inner.c.start_time.desc())

            # Apply limit (no additional cursor filtering needed here)
            # Time-range filtering already applied in base query via oldest/newest
            if windowing and windowing.limit:
                uniq = uniq.limit(windowing.limit)

            result = await session.execute(uniq)
            rows = result.all()

            # Return IDs as strings with cursor
            # Cursor is either last_active (realtime) or first_active (stable)
            ids = []
            activity_cursor = None
            for row in rows:
                id_value = getattr(row, f"{group}_id")
                if id_value:
                    ids.append(str(id_value))
                    # Activity cursor is set to the timestamp of the last row in the result set.
                    # This represents the boundary timestamp for the next page of results:
                    # - In descending order: cursor is the oldest timestamp in this page
                    # - In ascending order: cursor is the newest timestamp in this page
                    # The next query uses this as the starting point (oldest/newest boundary)
                    activity_cursor = getattr(row, activity_label)

            return ids, activity_cursor
