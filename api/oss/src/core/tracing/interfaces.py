from uuid import UUID
from typing import List, Optional

from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelLinks,
    OTelFlatSpan,
    OTelFlatSpans,
    Query,
)


class TracingDAOInterface:
    def __init__(self):
        raise NotImplementedError

    ### CRUD on spans

    async def create_span(
        self,
        *,
        project_id: UUID,
        span_dto: OTelFlatSpan,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLink]:
        raise NotImplementedError

    async def create_spans(
        self,
        *,
        project_id: UUID,
        span_dtos: OTelFlatSpans,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        raise NotImplementedError

    async def read_span(
        self,
        *,
        project_id: UUID,
        span_id: UUID,
    ) -> Optional[OTelFlatSpan]:
        raise NotImplementedError

    async def read_spans(
        self,
        *,
        project_id: UUID,
        span_ids: List[UUID],
    ) -> Optional[OTelFlatSpans]:
        raise NotImplementedError

    async def update_span(
        self,
        *,
        project_id: UUID,
        span_dto: OTelFlatSpan,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLink]:
        raise NotImplementedError

    async def update_spans(
        self,
        *,
        project_id: UUID,
        span_dtos: OTelFlatSpans,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        raise NotImplementedError

    async def delete_span(
        self,
        *,
        project_id: UUID,
        span_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLink]:
        raise NotImplementedError

    async def delete_spans(
        self,
        *,
        project_id: UUID,
        span_ids: List[UUID],
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        raise NotImplementedError

    ### .R.D on traces

    async def read_trace(
        self,
        *,
        project_id: UUID,
        trace_id: UUID,
    ) -> Optional[OTelFlatSpans]:
        raise NotImplementedError

    async def read_traces(
        self,
        *,
        project_id: UUID,
        trace_ids: List[UUID],
    ) -> Optional[OTelFlatSpans]:
        raise NotImplementedError

    async def delete_trace(
        self,
        *,
        project_id: UUID,
        trace_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        raise NotImplementedError

    async def delete_traces(
        self,
        *,
        project_id: UUID,
        trace_ids: List[UUID],
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        raise NotImplementedError

    ### RPC

    async def query(
        self,
        *,
        project_id: UUID,
        query: Query,
    ) -> Optional[OTelFlatSpans]:
        raise NotImplementedError
