from typing import Any, Callable, Dict, List, Optional, Tuple
from uuid import UUID
from abc import ABC, abstractmethod
from datetime import datetime

from oss.src.core.shared.dtos import Windowing
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelFlatSpan,
    TracingQuery,
    Bucket,
    MetricSpec,
    MetricsBucket,
    TraceTotals,
)
from oss.src.core.tracing.access import SpanReadScope


class TracingDAOInterface(ABC):
    def __init__(self):
        raise NotImplementedError

    ### SPANS

    @abstractmethod
    async def ingest(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        raise NotImplementedError

    @abstractmethod
    async def query(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        scope: SpanReadScope,
    ) -> List[OTelFlatSpan]:
        raise NotImplementedError

    @abstractmethod
    async def query_page(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        scope: SpanReadScope,
    ) -> Tuple[List[OTelFlatSpan], Optional[Windowing]]:
        raise NotImplementedError

    @abstractmethod
    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        specs: List[MetricSpec],
        scope: SpanReadScope,
    ) -> List[MetricsBucket]:
        raise NotImplementedError

    @abstractmethod
    async def legacy_analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        scope: SpanReadScope,
    ) -> List[Bucket]:
        raise NotImplementedError

    ### TRACES

    @abstractmethod
    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: Optional[List[UUID]] = None,
        span_ids: Optional[List[UUID]] = None,
        scope: SpanReadScope,
    ) -> List[OTelFlatSpan]:
        raise NotImplementedError

    @abstractmethod
    async def delete(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
        scope: SpanReadScope,
    ) -> List[OTelLink]:
        raise NotImplementedError

    @abstractmethod
    async def recompute_trace_metrics(
        self,
        *,
        project_id: UUID,
        trace_id: UUID,
        #
        recompute: Callable[[List[OTelFlatSpan]], Dict[str, Dict[str, Any]]],
        max_spans: int,
        scope: SpanReadScope,
    ) -> Optional[TraceTotals]:
        raise NotImplementedError

    ### SESSIONS AND USERS

    @abstractmethod
    async def sessions(
        self,
        *,
        project_id: UUID,
        #
        realtime: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        scope: SpanReadScope,
    ) -> Tuple[List[str], Optional[datetime]]:
        raise NotImplementedError

    @abstractmethod
    async def users(
        self,
        *,
        project_id: UUID,
        #
        realtime: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        scope: SpanReadScope,
    ) -> Tuple[List[str], Optional[datetime]]:
        raise NotImplementedError
