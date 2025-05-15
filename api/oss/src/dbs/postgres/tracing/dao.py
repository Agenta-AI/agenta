from typing import Optional, List
from uuid import UUID
from traceback import format_exc

from sqlalchemy import distinct, Column
from sqlalchemy import Select
from sqlalchemy.dialects.postgresql import dialect
from sqlalchemy.future import select

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.tracing.dbes import SpanDBE
from oss.src.dbs.postgres.tracing.mappings import (
    map_span_dbe_to_link_dto,
    map_span_dbe_to_span_dbe,
    map_span_dto_to_span_dbe,
    map_span_dbe_to_span_dto,
)

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelLinks,
    OTelFlatSpan,
    OTelFlatSpans,
    Query,
    Focus,
)

from oss.src.dbs.postgres.tracing.utils import combine, filter

log = get_module_logger(__name__)

DEBUG_ARGS = {"dialect": dialect(), "compile_kwargs": {"literal_binds": True}}


class TracingDAO(TracingDAOInterface):
    def __init__(self):
        pass

    ### CRUD on spans

    async def create_span(
        self,
        *,
        project_id: UUID,
        span_dto: OTelFlatSpan,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLink]:
        span_dbe = map_span_dto_to_span_dbe(
            project_id=project_id,
            span_dto=span_dto,
            user_id=user_id,
        )

        link_dto: Optional[OTelLink] = None
        async with engine.tracing_session() as session:
            try:
                session.add(span_dbe)
                await session.commit()

                link_dto = map_span_dbe_to_link_dto(
                    span_dbe=span_dbe,
                )

            except Exception:  # pylint: disable=broad-except
                log.warn(format_exc())

                await session.rollback()

        return link_dto

    async def create_spans(
        self,
        *,
        project_id: UUID,
        span_dtos: OTelFlatSpans,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        span_dbes = [
            map_span_dto_to_span_dbe(
                project_id=project_id,
                span_dto=span_dto,
                user_id=user_id,
            )
            for span_dto in span_dtos
        ]

        link_dtos: OTelLinks = []
        async with engine.tracing_session() as session:
            try:
                session.add_all(span_dbes)
                await session.commit()

                link_dtos = [
                    map_span_dbe_to_link_dto(
                        span_dbe=span_dbe,
                    )
                    for span_dbe in span_dbes
                ]

            except Exception:  # pylint: disable=broad-except
                log.warn(format_exc())

                await session.rollback()

        return link_dtos

    async def read_span(
        self,
        *,
        project_id: UUID,
        span_id: UUID,
    ) -> Optional[OTelFlatSpan]:
        span_dbe: Optional[SpanDBE] = None
        async with engine.tracing_session() as session:
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == span_id,
            )

            span_dbe = (await session.execute(query)).scalars().first()

        span_dto = map_span_dbe_to_span_dto(
            span_dbe=span_dbe,
        )

        return span_dto

    async def read_spans(
        self,
        *,
        project_id: UUID,
        span_ids: List[UUID],
    ) -> Optional[OTelFlatSpans]:
        span_dbes: List[SpanDBE] = []
        async with engine.tracing_session() as session:
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id.in_(span_ids),
            )

            span_dbes = (await session.execute(query)).scalars().all()

        span_dtos = [
            map_span_dbe_to_span_dto(
                span_dbe=span_dbe,
            )
            for span_dbe in span_dbes
        ]

        return span_dtos

    async def update_span(
        self,
        *,
        project_id: UUID,
        span_dto: OTelFlatSpan,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLink]:
        new_span_dbe = map_span_dto_to_span_dbe(
            project_id=project_id,
            span_dto=span_dto,
            user_id=user_id,
        )

        async with engine.tracing_session() as session:
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == new_span_dbe.span_id,
            )

            existing_span_dbe = (await session.execute(query)).scalars().first()

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

    async def update_spans(
        self,
        *,
        project_id: UUID,
        span_dtos: OTelFlatSpans,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        new_span_dbes = [
            map_span_dto_to_span_dbe(
                project_id=project_id,
                span_dto=span_dto,
                user_id=user_id,
            )
            for span_dto in span_dtos
        ]

        link_dtos: OTelLinks = []
        async with engine.tracing_session() as session:
            for new_span_dbe in new_span_dbes:
                query = select(SpanDBE).filter(
                    SpanDBE.project_id == project_id,
                    SpanDBE.span_id == new_span_dbe.span_id,
                )

                existing_span_dbe = (await session.execute(query)).scalars().first()

                if not existing_span_dbe:
                    continue

                map_span_dbe_to_span_dbe(
                    existing_span_dbe=existing_span_dbe,
                    new_span_dbe=new_span_dbe,
                    user_id=user_id,
                )

                link_dto = map_span_dbe_to_link_dto(
                    span_dbe=new_span_dbe,
                )

                link_dtos.append(link_dto)

            await session.commit()

        return link_dtos

    async def delete_span(
        self,
        *,
        project_id: UUID,
        span_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLink]:
        link_dto: Optional[OTelLink] = None
        async with engine.tracing_session() as session:
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id == span_id,
            )

            span_dbe = (await session.execute(query)).scalars().first()

            if not span_dbe:
                return None

            link_dto = map_span_dbe_to_link_dto(
                span_dbe=span_dbe,
            )

            await session.delete(span_dbe)
            await session.commit()

        return link_dto

    async def delete_spans(
        self,
        *,
        project_id: UUID,
        span_ids: List[UUID],
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        link_dtos: OTelLinks = []
        async with engine.tracing_session() as session:
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.span_id.in_(span_ids),
            )

            span_dbes = (await session.execute(query)).scalars().all()

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

    ### .R.D on traces

    async def read_trace(
        self,
        *,
        project_id: UUID,
        trace_id: UUID,
    ) -> Optional[OTelFlatSpans]:
        span_dbes: List[SpanDBE] = []
        async with engine.tracing_session() as session:
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id == trace_id,
            )

            span_dbes = (await session.execute(query)).scalars().all()

        if not span_dbes:
            return None

        span_dtos = [
            map_span_dbe_to_span_dto(
                span_dbe=span_dbe,
            )
            for span_dbe in span_dbes
        ]

        return span_dtos

    async def read_traces(
        self,
        *,
        project_id: UUID,
        trace_ids: List[UUID],
    ) -> Optional[OTelFlatSpans]:
        span_dbes: List[SpanDBE] = []
        async with engine.tracing_session() as session:
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id.in_(trace_ids),
            )

            span_dbes = (await session.execute(query)).scalars().all()

        if not span_dbes:
            return None

        span_dtos = [
            map_span_dbe_to_span_dto(
                span_dbe=span_dbe,
            )
            for span_dbe in span_dbes
        ]

        return span_dtos

    async def delete_trace(
        self,
        *,
        project_id: UUID,
        trace_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        async with engine.tracing_session() as session:
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id == trace_id,
            )

            span_dbes = (await session.execute(query)).scalars().all()

            if not span_dbes:
                return None

            for span_dbe in span_dbes:
                await session.delete(span_dbe)

            await session.commit()

        link_dtos = [
            map_span_dbe_to_link_dto(
                span_dbe=span_dbe,
            )
            for span_dbe in span_dbes
        ]

        return link_dtos

    async def delete_traces(
        self,
        *,
        project_id: UUID,
        trace_ids: List[UUID],
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        async with engine.tracing_session() as session:
            query = select(SpanDBE).filter(
                SpanDBE.project_id == project_id,
                SpanDBE.trace_id.in_(trace_ids),
            )

            span_dbes = (await session.execute(query)).scalars().all()

            if not span_dbes:
                return None

            for span_dbe in span_dbes:
                await session.delete(span_dbe)

            await session.commit()

        link_dtos = [
            map_span_dbe_to_link_dto(
                span_dbe=span_dbe,
            )
            for span_dbe in span_dbes
        ]

        return link_dtos

    ### RPC

    async def query(
        self,
        *,
        project_id: UUID,
        query: Query,
    ) -> Optional[OTelFlatSpans]:
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
            async with engine.tracing_session() as session:
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
                log.trace(_query)
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
                log.trace(str(query.compile(**DEBUG_ARGS)).replace("\n", " "))
                # ---------

                # QUERY EXECUTION
                dbes = (await session.execute(query)).scalars().all()
                # ---------------

            if not dbes:
                return []

            span_dtos = [map_span_dbe_to_span_dto(span_dbe=dbe) for dbe in dbes]

            return span_dtos

        except Exception as e:
            log.error(f"{type(e).__name__}: {e}")
            log.error(format_exc())
            raise e
