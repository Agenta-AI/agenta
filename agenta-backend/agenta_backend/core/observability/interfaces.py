from typing import List, Tuple, Optional
from uuid import UUID

from agenta_backend.core.observability.dtos import QueryDTO, SpanDTO


class ObservabilityDAOInterface:
    def __init__(self):
        raise NotImplementedError

    # ANALYTICS

    async def query(
        self,
        *,
        project_id: UUID,
        query_dto: QueryDTO,
    ) -> Tuple[List[SpanDTO], Optional[int]]:
        raise NotImplementedError

    # TRANSACTIONS

    async def create_one(
        self,
        *,
        project_id: UUID,
        span_dto: SpanDTO,
    ) -> None:
        raise NotImplementedError

    async def create_many(
        self,
        *,
        project_id: UUID,
        span_dtos: List[SpanDTO],
    ) -> None:
        raise NotImplementedError

    async def read_one(
        self,
        *,
        project_id: UUID,
        node_id: str,
    ) -> SpanDTO:
        raise NotImplementedError

    async def read_many(
        self,
        *,
        project_id: UUID,
        #
        node_ids: List[str],
    ) -> List[SpanDTO]:
        raise NotImplementedError

    async def delete_one(
        self,
        *,
        project_id: UUID,
        #
        node_id: str,
    ) -> None:
        raise NotImplementedError

    async def delete_many(
        self,
        *,
        project_id: UUID,
        #
        node_ids: List[str],
    ) -> None:
        raise NotImplementedError
