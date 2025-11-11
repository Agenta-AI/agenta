from uuid import UUID
from typing import List, Optional
from abc import ABC, abstractmethod

from oss.src.core.tracing.dtos import OTelLink, OTelFlatSpan, Query, Bucket


class TracingDAOInterface(ABC):
    def __init__(self):
        raise NotImplementedError

    ### CRUD on spans

    @abstractmethod
    async def create_span(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: OTelFlatSpan,
    ) -> Optional[OTelLink]:
        raise NotImplementedError

    @abstractmethod
    async def create_spans(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        raise NotImplementedError

    @abstractmethod
    async def read_span(
        self,
        *,
        project_id: UUID,
        #
        span_id: UUID,
    ) -> Optional[OTelFlatSpan]:
        raise NotImplementedError

    @abstractmethod
    async def read_spans(
        self,
        *,
        project_id: UUID,
        #
        span_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        raise NotImplementedError

    @abstractmethod
    async def update_span(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: OTelFlatSpan,
    ) -> Optional[OTelLink]:
        raise NotImplementedError

    @abstractmethod
    async def update_spans(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        raise NotImplementedError

    @abstractmethod
    async def delete_span(
        self,
        *,
        project_id: UUID,
        #
        span_id: UUID,
    ) -> Optional[OTelLink]:
        raise NotImplementedError

    @abstractmethod
    async def delete_spans(
        self,
        *,
        project_id: UUID,
        #
        span_ids: List[UUID],
    ) -> List[OTelLink]:
        raise NotImplementedError

    ### .R.D on traces

    @abstractmethod
    async def read_trace(
        self,
        *,
        project_id: UUID,
        #
        trace_id: UUID,
    ) -> List[OTelFlatSpan]:
        raise NotImplementedError

    @abstractmethod
    async def read_traces(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        raise NotImplementedError

    @abstractmethod
    async def delete_trace(
        self,
        *,
        project_id: UUID,
        #
        trace_id: UUID,
    ) -> List[OTelLink]:
        raise NotImplementedError

    @abstractmethod
    async def delete_traces(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelLink]:
        raise NotImplementedError

    ### QUERY

    @abstractmethod
    async def query(
        self,
        *,
        project_id: UUID,
        #
        query: Query,
    ) -> List[OTelFlatSpan]:
        raise NotImplementedError

    ### ANALYTICS

    @abstractmethod
    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: Query,
    ) -> List[Bucket]:
        raise NotImplementedError
