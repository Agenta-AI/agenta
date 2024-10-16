from typing import List, Optional

from agenta_backend.core.observability.interfaces import ObservabilityDAOInterface
from agenta_backend.core.observability.dtos import QueryDTO
from agenta_backend.core.observability.dtos import SpanDTO, SpanCreateDTO
from agenta_backend.core.observability.utils import (
    parse_span_dtos_to_span_idx,
    parse_span_idx_to_span_id_tree,
    calculate_costs,
    cumulate_costs,
    cumulate_tokens,
    connect_children,
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
        project_id: str,
        #
        query_dto: QueryDTO,
    ) -> List[SpanDTO]:
        span_dtos = await self.observability_dao.query(
            project_id=project_id,
            query_dto=query_dto,
        )

        if query_dto.grouping:
            span_idx = parse_span_dtos_to_span_idx(span_dtos)

            span_id_tree = parse_span_idx_to_span_id_tree(span_idx)

            connect_children(span_id_tree, span_idx)

            root_span_dtos = [
                span_dto for span_dto in span_idx.values() if span_dto.parent is None
            ]

            return root_span_dtos

        return span_dtos

    async def ingest(
        self,
        *,
        span_dtos: List[SpanCreateDTO],
    ) -> SpanDTO:
        span_idx = parse_span_dtos_to_span_idx(span_dtos)

        span_id_tree = parse_span_idx_to_span_id_tree(span_idx)

        calculate_costs(span_idx)

        cumulate_costs(span_id_tree, span_idx)

        cumulate_tokens(span_id_tree, span_idx)

        span_ids = await self.observability_dao.create_many(span_dtos=span_idx.values())

        return span_ids

    async def create(
        self,
        *,
        span_dto: Optional[SpanCreateDTO] = None,
        span_dtos: Optional[List[SpanCreateDTO]] = None,
    ) -> SpanDTO:
        if span_dto:
            return await self.observability_dao.create_one(
                span_dto=span_dto,
            )

        if span_dtos:
            return await self.observability_dao.create_many(
                span_dtos=span_dtos,
            )

    async def read(
        self,
        *,
        project_id: str,
        #
        node_id: Optional[str] = None,
        node_ids: Optional[List[str]] = None,
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
        project_id: str,
        #
        node_id: Optional[str] = None,
        node_ids: Optional[List[str]] = None,
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
