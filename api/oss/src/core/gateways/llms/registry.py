"""`LLMUpstreamRegistry` and `select_upstream` (entities.md §7.1, §8).

`select_upstream` is pure — no DAO, no vault, no I/O — so which adapter key a deployment
resolves to is a table reviewable and testable on its own, independent of any adapter's
construction. D34 forbids body conversion, so there is exactly one relay adapter for every
deployment kind; the `passthrough`/`translated` split it replaces is gone (open-designs.md
OD16).
"""

from typing import Dict, List, Optional

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind
from oss.src.core.gateways.llms.interfaces import LLMUpstreamInterface
from oss.src.core.gateways.llms.types import LLMAdapterNotFoundError


def select_upstream(
    provider_key: Optional[str], deployment_kind: LLMDeploymentKind
) -> str:  # noqa: ARG001
    """Picks the adapter key for the registry. Pure: no I/O, no DAO, no vault.

    `provider_key` decides nothing here any more (D34 removed the one branch that read it,
    entities.md §2.4) — kept as a parameter so callers do not need to change, but the whole
    decision is now `deployment_kind` alone: `MOCK` selects the test double, everything else
    is the one relay. A deployment kind with no routing/auth strategy (`sagemaker`, OD16)
    still resolves to `"relay"` here and fails at relay time, naming the reason — the
    registry only ever misses on a typo in this table, never on a provider fact.
    """
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
