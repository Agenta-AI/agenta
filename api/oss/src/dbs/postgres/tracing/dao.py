from typing import Any, Dict, Optional, List, cast as type_cast
from uuid import UUID
from traceback import format_exc
from datetime import datetime

from sqlalchemy import cast, func, select, text, distinct
from sqlalchemy.types import Numeric, BigInteger
from sqlalchemy.sql import Select, and_, or_
from sqlalchemy.exc import DBAPIError
from sqlalchemy import distinct, text
from sqlalchemy import Select, column
from sqlalchemy.dialects.postgresql import dialect
from sqlalchemy.future import select
from sqlalchemy.sql.elements import ColumnElement, Label
from sqlalchemy.dialects.postgresql import BIT

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.shared.dtos import Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
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
from oss.src.dbs.postgres.shared.exceptions import check_entity_creation_conflict
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.tracing.dbes import SpanDBE
from oss.src.dbs.postgres.tracing.mappings import (
    map_span_dbe_to_link_dto,
    map_span_dbe_to_span_dbe,
    map_span_dto_to_span_dbe,
    map_span_dbe_to_span_dto,
    map_buckets,
)
from oss.src.dbs.postgres.tracing.utils import (
    DEBUG_ARGS,
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

    ### CRUD on spans

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_span(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: OTelFlatSpan,
    ) -> Optional[OTelLink]:
        span_dbe = map_span_dto_to_span_dbe(
            project_id=project_id,
            user_id=user_id,
            #
            span_dto=span_dto,
        )

        try:
            async with engine.tracing_session() as session:
                session.add(span_dbe)

                await session.commit()

                link_dto = map_span_dbe_to_link_dto(
                    span_dbe=span_dbe,
                )

                return link_dto

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions(default=[], exclude=[EntityCreationConflict])
    async def create_spans(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        span_dbes = [
            map_span_dto_to_span_dbe(
                project_id=project_id,
                user_id=user_id,
                #
                span_dto=span_dto,
            )
            for span_dto in span_dtos
        ]

        try:
            async with engine.tracing_session() as session:
                session.add_all(span_dbes)

                await session.commit()

                link_dtos = [
                    map_span_dbe_to_link_dto(
                        span_dbe=span_dbe,
                    )
                    for span_dbe in span_dbes
                ]

                return link_dtos

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def read_span(
        self,
        *,
        project_id: UUID,
        #
        span_id: UUID,
    ) -> Optional[OTelFlatSpan]:
        async with engine.tracing_session() as session:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == span_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            span_dbe = result.scalars().first()

            if not span_dbe:
                return None

            span_dto = map_span_dbe_to_span_dto(
                span_dbe=span_dbe,
            )

            return span_dto

    @suppress_exceptions(default=[])
    async def read_spans(
        self,
        *,
        project_id: UUID,
        #
        span_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        async with engine.tracing_session() as session:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id.in_(span_ids),
            )

            stmt = stmt.limit(len(span_ids))

            result = await session.execute(stmt)

            span_dbes = result.scalars().all()

            span_dtos = [
                map_span_dbe_to_span_dto(
                    span_dbe=span_dbe,
                )
                for span_dbe in span_dbes
            ]

            return span_dtos

    @suppress_exceptions()
    async def update_span(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: OTelFlatSpan,
    ) -> Optional[OTelLink]:
        new_span_dbe = map_span_dto_to_span_dbe(
            project_id=project_id,
            user_id=user_id,
            #
            span_dto=span_dto,
        )

        async with engine.tracing_session() as session:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == new_span_dbe.span_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            existing_span_dbe = result.scalars().first()

            if not existing_span_dbe:
                return None

            map_span_dbe_to_span_dbe(
                existing_span_dbe=existing_span_dbe,
                new_span_dbe=new_span_dbe,
                user_id=user_id,
            )

            await session.commit()

            link_dto = map_span_dbe_to_link_dto(
                span_dbe=new_span_dbe,
            )

            return link_dto

    @suppress_exceptions(default=[])
    async def update_spans(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        new_span_dbes = [
            map_span_dto_to_span_dbe(
                project_id=project_id,
                user_id=user_id,
                #
                span_dto=span_dto,
            )
            for span_dto in span_dtos
        ]

        span_ids = [span_dbe.span_id for span_dbe in new_span_dbes]

        async with engine.tracing_session() as session:
            link_dtos: List[OTelLink] = []

            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id.in_(span_ids),
            )

            stmt = stmt.limit(len(span_ids))

            result = await session.execute(stmt)

            existing_span_dbes = result.scalars().all()

            if not existing_span_dbes:
                return link_dtos

            existing_span_dbes = {
                span_dbe.span_id: span_dbe for span_dbe in existing_span_dbes
            }

            for new_span_dbe in new_span_dbes:
                existing_span_dbe = existing_span_dbes.get(new_span_dbe.span_id)

                if existing_span_dbe:
                    map_span_dbe_to_span_dbe(
                        existing_span_dbe=existing_span_dbe,
                        new_span_dbe=new_span_dbe,
                        user_id=user_id,
                    )

                    del existing_span_dbes[new_span_dbe.span_id]

                else:
                    session.add(new_span_dbe)

                link_dto = map_span_dbe_to_link_dto(
                    span_dbe=new_span_dbe,
                )

                link_dtos.append(link_dto)

            for remaining_span_dbe in existing_span_dbes.values():
                await session.delete(remaining_span_dbe)

            await session.commit()

            return link_dtos

    @suppress_exceptions()
    async def delete_span(
        self,
        *,
        project_id: UUID,
        # user_id: UUID,
        #
        span_id: UUID,
    ) -> Optional[OTelLink]:
        async with engine.tracing_session() as session:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == span_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            span_dbe = result.scalars().first()

            if not span_dbe:
                return None

            link_dto = map_span_dbe_to_link_dto(
                span_dbe=span_dbe,
            )

            await session.delete(span_dbe)

            await session.commit()

            return link_dto

    @suppress_exceptions(default=[])
    async def delete_spans(
        self,
        *,
        project_id: UUID,
        # user_id: UUID,
        #
        span_ids: List[UUID],
    ) -> List[OTelLink]:
        async with engine.tracing_session() as session:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id.in_(span_ids),
            )

            stmt = stmt.limit(len(span_ids))

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

    ### .R.D on traces

    @suppress_exceptions(default=[])
    async def read_trace(
        self,
        *,
        project_id: UUID,
        #
        trace_id: UUID,
    ) -> List[OTelFlatSpan]:
        async with engine.tracing_session() as session:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id == trace_id,
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
    async def read_traces(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
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
    async def delete_trace(
        self,
        *,
        project_id: UUID,
        # user_id: UUID,
        #
        trace_id: UUID,
    ) -> List[OTelLink]:
        async with engine.tracing_session() as session:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id == trace_id,
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

    @suppress_exceptions(default=[])
    async def delete_traces(
        self,
        *,
        project_id: UUID,
        # user_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelLink]:
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

    ### QUERY

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

    ### ANALYTICS

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

    ### SESSIONS AND ACTORS

    @suppress_exceptions(default=[])
    async def sessions(
        self,
        *,
        project_id: UUID,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[str]:
        """Query unique session IDs with windowing support."""
        try:
            async with engine.tracing_session() as session:
                # TIMEOUT
                await session.execute(TIMEOUT_STMT)

                # Select distinct session IDs from JSONB
                stmt = (
                    select(
                        distinct(SpanDBE.attributes["ag.session.id"].as_string()).label(
                            "session_id"
                        )
                    )
                    .filter(SpanDBE.project_id == project_id)
                    .filter(SpanDBE.attributes.has_key("ag.session.id"))
                )

                # Apply windowing
                if windowing:
                    stmt = apply_windowing(
                        stmt=stmt,
                        DBE=SpanDBE,
                        attribute="start_time",
                        order="descending",
                        windowing=windowing,
                    )

                result = await session.execute(stmt)
                rows = result.all()

                # Return session IDs as strings
                session_ids = []
                for row in rows:
                    if row.session_id:
                        session_ids.append(str(row.session_id))

                return session_ids

        except Exception as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())
            raise e

    @suppress_exceptions(default=[])
    async def users(
        self,
        *,
        project_id: UUID,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[str]:
        """Query unique user IDs with windowing support."""
        try:
            async with engine.tracing_session() as session:
                # TIMEOUT
                await session.execute(TIMEOUT_STMT)

                # Select distinct user IDs from JSONB
                stmt = (
                    select(
                        distinct(SpanDBE.attributes["ag.user.id"].as_string()).label(
                            "user_id"
                        )
                    )
                    .filter(SpanDBE.project_id == project_id)
                    .filter(SpanDBE.attributes.has_key("ag.user.id"))
                )

                # Apply windowing
                if windowing:
                    stmt = apply_windowing(
                        stmt=stmt,
                        DBE=SpanDBE,
                        attribute="start_time",
                        order="descending",
                        windowing=windowing,
                    )

                result = await session.execute(stmt)
                rows = result.all()

                # Return user IDs as strings
                user_ids = []
                for row in rows:
                    if row.user_id:
                        user_ids.append(str(row.user_id))

                return user_ids

        except Exception as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())
            raise e
