from typing import List, Optional
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from oss.src.apis.fastapi.shared.models import VersionedModel

from oss.src.core.observability.dtos import (
    OTelSpanDTO,
    SpanDTO,
    TreeDTO,
    RootDTO,
    BucketDTO,
)


class CollectStatusResponse(VersionedModel):
    status: str


class OTelTracingResponse(VersionedModel):
    count: Optional[int] = None
    spans: List[OTelSpanDTO]

    model_config = ConfigDict(title="OTelTracingDataResponse")


class AgentaNodeDTO(SpanDTO):
    pass


class AgentaNodesDTO(BaseModel):
    nodes: Optional[List[AgentaNodeDTO]] = []


class AgentaTreeDTO(BaseModel):
    tree: TreeDTO

    nodes: List[AgentaNodeDTO]


class AgentaTreesDTO(BaseModel):
    trees: Optional[List[AgentaTreeDTO]] = []


class AgentaRootDTO(BaseModel):
    root: RootDTO

    trees: List[AgentaTreeDTO]


class AgentaRootsDTO(BaseModel):
    roots: Optional[List[AgentaRootDTO]] = []


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
