from typing import List, Optional
from pydantic import BaseModel

from agenta_backend.apis.fastapi.shared.models import VersionedModel

from agenta_backend.core.observability.dtos import (
    OTelSpanDTO,
    SpanDTO,
    TreeDTO,
    RootDTO,
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
