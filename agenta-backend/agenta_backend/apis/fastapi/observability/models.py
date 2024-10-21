from typing import List, Dict

from agenta_backend.apis.fastapi.shared.models import DisplayBase, VersionedModel

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


class AgentaNodesDTO(DisplayBase):
    nodes: Dict[str, AgentaNodeDTO]


class AgentaTreeDTO(DisplayBase):
    tree: TreeDTO

    nodes: Dict[str, AgentaNodeDTO]


class AgentaTreesDTO(DisplayBase):
    trees: List[AgentaTreeDTO]  # -> Dict with tree.name ?


class AgentaRootDTO(DisplayBase):
    root: RootDTO

    trees: List[AgentaTreeDTO]  # -> Dict with tree.name ?


class AgentaRootsDTO(DisplayBase):
    roots: List[AgentaRootDTO]  # -> Dict with root.name ? root.id ?


class AgentaNodesResponse(VersionedModel, AgentaNodesDTO):
    pass


class AgentaTreesResponse(VersionedModel, AgentaTreesDTO):
    pass


class AgentaRootsResponse(VersionedModel, AgentaRootsDTO):
    pass
