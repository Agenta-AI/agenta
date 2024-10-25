from typing import List
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
    pass


class OTelSpansResponse(VersionedModel):
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
    pass


class AgentaTreesResponse(VersionedModel, AgentaTreesDTO):
    pass


class AgentaRootsResponse(VersionedModel, AgentaRootsDTO):
    pass
