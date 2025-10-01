from typing import Optional, List
from uuid import UUID
from traceback import format_exc

from sqlalchemy.exc import DBAPIError
from sqlalchemy import distinct, text
from sqlalchemy import Select, column
from sqlalchemy.dialects.postgresql import dialect
from sqlalchemy.future import select
from sqlalchemy import func, cast, Numeric
from sqlalchemy.dialects import postgresql

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelFlatSpan,
    Query,
    Focus,
    Bucket,
    Condition,
    ListOperator,
)

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
    combine,
    filter,
    parse_windowing,
)


log = get_module_logger(__name__)

DEBUG_ARGS = {"dialect": dialect(), "compile_kwargs": {"literal_binds": True}}
STATEMENT_TIMEOUT = 60_000  # milliseconds
TIMEOUT_STATEMENT = text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")


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
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == span_id,
            )

            query = query.limit(1)

            result = await session.execute(query)

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
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id.in_(span_ids),
            )

            query = query.limit(len(span_ids))

            result = await session.execute(query)

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
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == new_span_dbe.span_id,
            )

            query = query.limit(1)

            result = await session.execute(query)

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

            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id.in_(span_ids),
            )

            query = query.limit(len(span_ids))

            result = await session.execute(query)

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
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == span_id,
            )

            query = query.limit(1)

            result = await session.execute(query)

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
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id.in_(span_ids),
            )

            query = query.limit(len(span_ids))

            result = await session.execute(query)

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
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id == trace_id,
            )

            query = query.order_by(SpanDBE.start_time.asc())

            result = await session.execute(query)

            span_dbes = result.scalars().all()

            if not span_dbes:
                return None

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
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id.in_(trace_ids),
            )

            query = query.order_by(SpanDBE.start_time.asc())

            result = await session.execute(query)

            span_dbes = result.scalars().all()

            if not span_dbes:
                return None

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
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id == trace_id,
            )

            result = await session.execute(query)

            span_dbes = result.scalars().all()

            if not span_dbes:
                return None

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
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id.in_(trace_ids),
            )

            result = await session.execute(query)

            span_dbes = result.scalars().all()

            if not span_dbes:
                return None

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
        query: Query,
    ) -> List[OTelFlatSpan]:
        # DE-STRUCTURING
        focus = query.formatting.focus if query.formatting else None

        oldest = query.windowing.oldest if query.windowing else None
        newest = query.windowing.newest if query.windowing else None
        limit = query.windowing.limit if query.windowing else None

        operator = query.filtering.operator if query.filtering else None
        conditions = query.filtering.conditions if query.filtering else None
        # --------------

        try:
            async with engine.tracing_session() as session:
                # TIMEOUT
                await session.execute(TIMEOUT_STATEMENT)
                # -------

                # BASE (SUB-)STMT
                base: Select = select(SpanDBE)
                # ---------------

                # GROUPING
                if focus == Focus.TRACE:
                    base = select(
                        SpanDBE.trace_id,
                        SpanDBE.created_at,
                    ).distinct(SpanDBE.trace_id)
                # --------

                # SCOPING
                base = base.filter(SpanDBE.project_id == project_id)
                # -------

                # WINDOWING
                if oldest:
                    base = base.filter(SpanDBE.start_time >= oldest)
                if newest:
                    base = base.filter(SpanDBE.start_time < newest)
                # ---------

                # DEBUGGING
                # log.trace(query)
                # ---------

                # FILTERING
                if operator and conditions:
                    base = base.filter(combine(operator, filter(conditions)))
                # ---------

                # GROUPING
                if focus == Focus.TRACE:
                    base = base.order_by(SpanDBE.trace_id, SpanDBE.created_at.desc())

                    inner = base.subquery("latest_per_trace")

                    # now order by created_at DESC globally and apply LIMIT here
                    uniq = select(inner.c.trace_id)
                    uniq = uniq.order_by(inner.c.created_at.desc())
                    if limit:
                        uniq = uniq.limit(limit)

                    stmt = (
                        select(SpanDBE)
                        .filter(SpanDBE.trace_id.in_(uniq))
                        .order_by(SpanDBE.created_at.desc(), SpanDBE.start_time.asc())
                    )
                else:
                    stmt = base.order_by(SpanDBE.created_at.desc())

                    if limit:
                        stmt = stmt.limit(limit)
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
                    "Query execution was cancelled due to timeout. "
                    "Please try again with a smaller time window."
                ) from e

            raise e

        except Exception as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())
            raise e

    ### ANALYTICS

    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: Query,
    ) -> List[Bucket]:
        (
            oldest,
            newest,
            stride,
            window,
            timestamps,
        ) = parse_windowing(query.windowing)

        # DEBUGGING
        # log.trace(query.model_dump(mode="json", exclude_none=True))
        # ---------

        try:
            async with engine.tracing_session() as session:
                stmt = text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
                await session.execute(stmt)

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
                total_query = select(
                    _count,
                    _duration,
                    _costs,
                    _tokens,
                    _timestamp,
                ).select_from(SpanDBE)

                errors_query = select(
                    _count,
                    _duration,
                    _costs,
                    _tokens,
                    _timestamp,
                ).select_from(SpanDBE)
                # ----------

                # WINDOWING
                total_query = total_query.filter(
                    SpanDBE.created_at >= oldest,
                    SpanDBE.created_at < newest,
                )

                errors_query = errors_query.filter(
                    SpanDBE.created_at >= oldest,
                    SpanDBE.created_at < newest,
                )
                # ---------

                # SCOPING
                total_query = total_query.filter_by(
                    project_id=project_id,
                )

                errors_query = errors_query.filter_by(
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

                    total_query = total_query.filter(
                        combine(
                            operator,
                            filter(conditions),
                        )
                    )

                    errors_query = errors_query.filter(
                        combine(
                            operator,
                            filter(
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
                # ---------

                # GROUPING
                if query.formatting and query.formatting.focus == Focus.TRACE:
                    total_query = total_query.filter_by(
                        parent_id=None,
                    )

                    errors_query = errors_query.filter_by(
                        parent_id=None,
                    )
                # --------

                # SORTING
                total_query = total_query.group_by("timestamp")

                errors_query = errors_query.group_by("timestamp")
                # -------

                # DEBUGGING
                # log.trace(str(total_query.compile(**DEBUG_ARGS)).replace("\n", " "))
                # log.trace(str(errors_query.compile(**DEBUG_ARGS)).replace("\n", " "))
                # ---------

                # QUERY EXECUTION
                total_buckets = (await session.execute(total_query)).all()
                errors_buckets = (await session.execute(errors_query)).all()
                # ---------------

                buckets = map_buckets(
                    total_buckets=total_buckets,
                    errors_buckets=errors_buckets,
                    window=window,
                    timestamps=timestamps,
                )

            return buckets

        except DBAPIError as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())

            if "AnalyticsCanceledError" in str(e.orig):
                raise Exception(  # pylint: disable=broad-exception-raised
                    "Analytics execution was cancelled due to timeout. "
                    "Please try again with a smaller time window."
                ) from e

            raise e

        except Exception as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())
            raise e
