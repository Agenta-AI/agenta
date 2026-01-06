from typing import List, Optional, Tuple
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
)


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
    ) -> List[OTelFlatSpan]:
        raise NotImplementedError

    @abstractmethod
    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        specs: List[MetricSpec],
    ) -> List[MetricsBucket]:
        raise NotImplementedError

    @abstractmethod
    async def legacy_analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
    ) -> List[Bucket]:
        raise NotImplementedError

    ### TRACES

    @abstractmethod
    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        raise NotImplementedError

    @abstractmethod
    async def delete(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelLink]:
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
    ) -> Tuple[List[str], Optional[datetime]]:
        raise NotImplementedError
