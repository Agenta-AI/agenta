"""`LlmUpstreamRegistry` and `select_upstream` (entities.md §7.1, §8).

`select_upstream` is pure — no DAO, no vault, no I/O — so the wave's adapter split (which
provider's wire is OpenAI-shaped versus which needs the routing library) is a table
reviewable and testable on its own, independent of any adapter's construction.
"""

from typing import Dict, List

from oss.src.core.gateways.llms.dtos import LlmDeploymentKind
from oss.src.core.gateways.llms.interfaces import LlmUpstreamInterface
from oss.src.core.gateways.llms.types import LlmAdapterNotFoundError

# The fake upstream is selected on provider_key alone, ahead of the deployment split —
# the fakes register under a third key (entities.md §7.1) and are reachable only through
# a seeded endpoint naming this provider (D23; reachability is WP1/WP10's concern).
_FAKE_PROVIDER_KEY = "fake"

# Cloud-reseller deployments: auth is request signing, never a bearer header, so the wire
# is never byte-for-byte by construction (§7.1) — always translated.
_TRANSLATED_DEPLOYMENTS = {
    LlmDeploymentKind.AZURE,
    LlmDeploymentKind.BEDROCK,
    LlmDeploymentKind.SAGEMAKER,
    LlmDeploymentKind.VERTEX,
}

# DIRECT providers whose own chat-completions wire is already OpenAI-shaped (verified
# against litellm's base URLs and provider docs at the time this table was written; a
# provider litellm later adds OpenAI-compatible support for moves row, not the design).
_DIRECT_PASSTHROUGH_PROVIDERS = {
    "openai",
    "groq",
    "together_ai",
    "openrouter",
    "mistral",
    "mistralai",
}

# DIRECT providers whose native wire differs from OpenAI's — litellm already knows each
# shape (D9).
_DIRECT_TRANSLATED_PROVIDERS = {
    "anthropic",
    "gemini",
    "cohere",
    "deepinfra",
    "perplexityai",
    "minimax",
}


def select_upstream(provider_key: str, deployment: LlmDeploymentKind) -> str:
    """Picks the adapter key for the registry. Pure: no I/O, no DAO, no vault."""
    if provider_key == _FAKE_PROVIDER_KEY:
        return "fake"

    if deployment in _TRANSLATED_DEPLOYMENTS:
        return "translated"

    if deployment == LlmDeploymentKind.CUSTOM:
        return "passthrough"

    # DIRECT: OpenAI-shaped providers relay byte for byte; everything else — including a
    # provider absent from both known sets — goes through the routing library, since a
    # wrong "passthrough" guess would relay bytes the upstream cannot parse while a wrong
    # "translated" guess merely spends an unnecessary re-serialization.
    return (
        "passthrough" if provider_key in _DIRECT_PASSTHROUGH_PROVIDERS else "translated"
    )


class LlmUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, LlmUpstreamInterface]) -> None:
        self._adapters = adapters

    def get(self, key: str) -> LlmUpstreamInterface:
        adapter = self._adapters.get(key)
        if adapter is None:
            raise LlmAdapterNotFoundError(key=key)
        return adapter

    def keys(self) -> List[str]:
        return list(self._adapters.keys())
