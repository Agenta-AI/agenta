"""LLM upstream registry and adapter selection."""

from typing import Dict, List, Optional

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind
from oss.src.core.gateways.llms.interfaces import LLMUpstreamInterface
from oss.src.core.gateways.llms.types import LLMAdapterNotFoundError


def select_upstream(
    provider_key: Optional[str], deployment_kind: LLMDeploymentKind
) -> str:  # noqa: ARG001
    """Select the mock adapter or the general relay adapter by deployment kind."""
    if deployment_kind == LLMDeploymentKind.MOCK:
        return "mock"
    return "relay"


class LLMUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, LLMUpstreamInterface]) -> None:
        self._adapters = adapters

    def get(self, key: str) -> LLMUpstreamInterface:
        adapter = self._adapters.get(key)
        if adapter is None:
            raise LLMAdapterNotFoundError(key=key)
        return adapter

    def keys(self) -> List[str]:
        return list(self._adapters.keys())
