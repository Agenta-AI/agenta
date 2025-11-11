from typing import Optional, List
from uuid import UUID
from traceback import format_exc

from sqlalchemy.exc import DBAPIError
from sqlalchemy import distinct, text
from sqlalchemy import Select
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
        async with engine.tracing_connection() as connection:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == span_id,
            )

            stmt = stmt.limit(1)

            result = await connection.execute(stmt=stmt, prepare=True)

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
        async with engine.tracing_connection() as connection:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id.in_(span_ids),
            )

            stmt = stmt.limit(len(span_ids))

            result = await connection.execute(stmt=stmt, prepare=True)

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
        async with engine.tracing_connection() as connection:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id == trace_id,
            )

            stmt = stmt.order_by(SpanDBE.start_time.asc())

            result = await connection.execute(stmt=stmt, prepare=True)

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
        async with engine.tracing_connection() as connection:
            stmt = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id.in_(trace_ids),
            )

            stmt = stmt.order_by(SpanDBE.start_time.asc())

            result = await connection.execute(stmt=stmt, prepare=True)

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
        _query = query

        # DE-STRUCTURING ARGS
        formatting = _query.formatting
        windowing = _query.windowing
        filtering = _query.filtering

        focus = formatting.focus if formatting else None

        oldest = windowing.oldest if windowing else None
        newest = windowing.newest if windowing else None
        limit = windowing.limit if windowing else None

        operator = filtering.operator if filtering else None
        conditions = filtering.conditions if filtering else None
        # -------------------

        try:
            async with engine.tracing_connection() as connection:
                stmt = text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
                await connection.execute(stmt)

                # BASE (SUB-)QUERY
                query: Select = select(SpanDBE)
                # ----------------

                # GROUPING
                if focus == Focus.TRACE:
                    distinct_ids = distinct(SpanDBE.trace_id).label("grouping_key")

                    query = select(distinct_ids, SpanDBE.start_time)
                # --------

                # SCOPING
                query = query.filter(SpanDBE.project_id == project_id)
                # -------

                # WINDOWING
                if oldest:
                    query = query.filter(SpanDBE.start_time >= oldest)

                if newest:
                    query = query.filter(SpanDBE.start_time < newest)
                # ---------

                # DEBUGGING
                # log.trace(_query)
                # ---------

                # FILTERING
                if filtering:
                    query = query.filter(combine(operator, filter(conditions)))
                # ---------

                # SORTING
                query = query.order_by(SpanDBE.start_time.desc())
                # -------

                # WINDOWING
                if limit:
                    query = query.limit(limit)
                # --------

                # GROUPING
                if focus == Focus.TRACE:
                    subquery = select(query.subquery().c["grouping_key"])

                    query = select(SpanDBE)

                    query = query.filter(SpanDBE.trace_id.in_(subquery))

                    # SORTING
                    query = query.order_by(SpanDBE.start_time.asc())
                    # -------
                # --------

                # DEBUGGING
                # log.trace(str(query.compile(**DEBUG_ARGS)).replace("\n", " "))
                # ---------

                # QUERY EXECUTION
                dbes = (await connection.execute(query)).scalars().all()
                # ---------------

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

        try:
            async with engine.tracing_connection() as connection:
                stmt = text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
                await connection.execute(stmt)

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
                errors_query = errors_query.filter(
                    SpanDBE.attributes["ag.exception"].isnot(None),
                )
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
                            filter(conditions),
                        )
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
                total_buckets_rows = (
                    (await connection.execute(total_query)).mappings().all()
                )
                errors_buckets_rows = (
                    (await connection.execute(errors_query)).mappings().all()
                )
                # ---------------

                buckets = map_buckets(
                    total_buckets=total_buckets_rows,
                    errors_buckets=errors_buckets_rows,
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
