from typing import List, Optional, Tuple
from uuid import UUID

from agenta_backend.core.observability.interfaces import ObservabilityDAOInterface
from agenta_backend.core.observability.dtos import (
    QueryDTO,
    AnalyticsDTO,
    SpanDTO,
    BucketDTO,
)
from agenta_backend.core.observability.utils import (
    parse_span_dtos_to_span_idx,
    parse_span_idx_to_span_id_tree,
    calculate_costs,
    cumulate_costs,
    cumulate_tokens,
    connect_children,
    parse_filtering,
    parse_ingest,
)


class ObservabilityService:
    def __init__(
        self,
        observability_dao: ObservabilityDAOInterface,
    ):
        self.observability_dao = observability_dao

    async def query(
        self,
        *,
        project_id: UUID,
        query_dto: QueryDTO,
    ) -> Tuple[List[SpanDTO], Optional[int]]:
        if query_dto.filtering:
            parse_filtering(query_dto.filtering)

        span_dtos, count = await self.observability_dao.query(
            project_id=project_id,
            query_dto=query_dto,
        )

        if query_dto.grouping and query_dto.grouping.focus.value != "node":
            span_idx = parse_span_dtos_to_span_idx(span_dtos)

            span_id_tree = parse_span_idx_to_span_id_tree(span_idx)

            connect_children(span_id_tree, span_idx)

            span_dtos = [
                span_dto for span_dto in span_idx.values() if span_dto.parent is None
            ]

        return span_dtos, count

    async def analytics(
        self,
        *,
        project_id: UUID,
        analytics_dto: AnalyticsDTO,
    ) -> Tuple[List[BucketDTO], Optional[int]]:
        if analytics_dto.filtering:
            parse_filtering(analytics_dto.filtering)

        bucket_dtos, count = await self.observability_dao.analytics(
            project_id=project_id,
            analytics_dto=analytics_dto,
        )

        return bucket_dtos, count

    async def ingest(
        self,
        *,
        project_id: UUID,
        span_dtos: List[SpanDTO],
    ) -> None:
        parse_ingest(span_dtos)

        span_idx = parse_span_dtos_to_span_idx(span_dtos)

        span_id_tree = parse_span_idx_to_span_id_tree(span_idx)

        calculate_costs(span_idx)

        cumulate_costs(span_id_tree, span_idx)

        cumulate_tokens(span_id_tree, span_idx)

        await self.observability_dao.create_many(
            project_id=project_id,
            span_dtos=span_idx.values(),
        )

    async def create(
        self,
        *,
        project_id: UUID,
        span_dto: Optional[SpanDTO] = None,
        span_dtos: Optional[List[SpanDTO]] = None,
    ) -> SpanDTO:
        if span_dto:
            return await self.observability_dao.create_one(
                project_id=project_id,
                span_dto=span_dto,
            )

        if span_dtos:
            return await self.observability_dao.create_many(
                project_id=project_id,
                span_dtos=span_dtos,
            )

    async def read(
        self,
        *,
        project_id: UUID,
        node_id: Optional[UUID] = None,
        node_ids: Optional[List[UUID]] = None,
    ) -> SpanDTO:
        if node_id:
            return await self.observability_dao.read_one(
                project_id=project_id,
                node_id=node_id,
            )

        if node_ids:
            return await self.observability_dao.read_many(
                project_id=project_id,
                node_ids=node_ids,
            )

    async def delete(
        self,
        *,
        project_id: UUID,
        node_id: Optional[UUID] = None,
        node_ids: Optional[List[UUID]] = None,
    ):
        if node_id:
            return await self.observability_dao.delete_one(
                project_id=project_id,
                node_id=node_id,
            )

        if node_ids:
            return await self.observability_dao.delete_many(
                project_id=project_id,
                node_ids=node_ids,
            )
