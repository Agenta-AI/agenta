from typing import List, Optional
from datetime import datetime

from pydantic import BaseModel

from agenta_backend.apis.fastapi.shared.models import VersionedModel

from agenta_backend.core.observability.dtos import (
    OTelSpanDTO,
    SpanDTO,
    TreeDTO,
    RootDTO,
    BucketDTO,
)


class CollectStatusResponse(VersionedModel):
    status: str


class OTelSpansResponse(VersionedModel):
    count: Optional[int] = None
    spans: List[OTelSpanDTO]


class AgentaNodeDTO(SpanDTO):
    pass


class AgentaNodesDTO(BaseModel):
    nodes: List[AgentaNodeDTO]


class AgentaTreeDTO(BaseModel):
    tree: TreeDTO

    nodes: List[AgentaNodeDTO]


class AgentaTreesDTO(BaseModel):
    trees: List[AgentaTreeDTO]


class AgentaRootDTO(BaseModel):
    root: RootDTO

    trees: List[AgentaTreeDTO]


class AgentaRootsDTO(BaseModel):
    roots: List[AgentaRootDTO]


class AgentaNodesResponse(VersionedModel, AgentaNodesDTO):
    count: Optional[int] = None


class AgentaTreesResponse(VersionedModel, AgentaTreesDTO):
    count: Optional[int] = None


class AgentaRootsResponse(VersionedModel, AgentaRootsDTO):
    count: Optional[int] = None


class LegacySummary(BaseModel):
    total_count: int
    failure_rate: float
    total_cost: float
    avg_cost: float
    avg_latency: float
    total_tokens: int
    avg_tokens: float


class LegacyDataPoint(BaseModel):
    timestamp: datetime
    success_count: int
    failure_count: int
    cost: float
    latency: float
    total_tokens: int


class LegacyAnalyticsResponse(LegacySummary):
    data: List[LegacyDataPoint]


class AnalyticsResponse(VersionedModel):
    count: Optional[int] = None
    buckets: List[BucketDTO]
