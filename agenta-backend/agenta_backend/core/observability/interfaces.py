from typing import List

from agenta_backend.core.observability.dtos import QueryDTO
from agenta_backend.core.observability.dtos import SpanDTO, SpanCreateDTO


class ObservabilityDAOInterface:
    def __init__(self):
        raise NotImplementedError

    # ANALYTICS

    async def query(
        self,
        *,
        project_id: str,
        #
        query_dto: QueryDTO,
    ) -> List[SpanDTO]:
        raise NotImplementedError

    # TRANSACTIONS

    async def create_one(
        self,
        *,
        span_dto: SpanCreateDTO,
    ) -> None:
        raise NotImplementedError

    async def create_many(
        self,
        *,
        span_dtos: List[SpanCreateDTO],
    ) -> None:
        raise NotImplementedError

    async def read_one(
        self,
        *,
        project_id: str,
        #
        node_id: str,
    ) -> SpanDTO:
        raise NotImplementedError

    async def read_many(
        self,
        *,
        project_id: str,
        #
        node_ids: List[str],
    ) -> List[SpanDTO]:
        raise NotImplementedError

    async def delete_one(
        self,
        *,
        project_id: str,
        #
        node_id: str,
    ) -> None:
        raise NotImplementedError

    async def delete_many(
        self,
        *,
        project_id: str,
        #
        node_ids: List[str],
    ) -> None:
        raise NotImplementedError
