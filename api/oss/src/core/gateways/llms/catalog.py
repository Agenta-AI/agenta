"""The generated standard-endpoint catalogue (entities.md §8, D20).

Two pure functions over the SDK's static provider->model map. A standard endpoint is
derived, never stored: no id, no `Lifecycle`, code-default `settings`. Existence for a given
project is answered by the resolver's `available_provider_keys` (R2), not by this module —
`standard_llm_endpoint` never queries a DAO or the vault.
"""

from typing import List, Optional

from agenta.sdk.agents.connections.endpoints import direct_endpoint
from agenta.sdk.utils.assets import supported_llm_models

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointData,
    LLMEndpointRoute,
    LLMModelFilter,
)
from oss.src.core.gateways.llms.registry import select_upstream
from oss.src.core.shared.dtos import Header


def standard_llm_endpoint(*, provider_key: str) -> Optional[LLMEndpoint]:
    """The generated endpoint for one provider, or None when `provider_key` has no
    entry in `supported_llm_models` — covers both an unknown string and the three
    `StandardProviderKind` members with no catalogue entry (`anyscale`, `alephalpha`,
    `mistralai`)."""
    model_slugs = supported_llm_models.get(provider_key)
    if model_slugs is None:
        return None

    return LLMEndpoint(
        slug=provider_key,
        header=Header(name=provider_key),
        provider_key=provider_key,
        deployment_kind=LLMDeploymentKind.DIRECT,
        namespace=GatewayEndpointNamespace.STANDARD,
        data=LLMEndpointData(
            route=_route(provider_key),
            models=LLMModelFilter(allowlist=list(model_slugs)),
        ),
    )


def _route(provider_key: str) -> LLMEndpointRoute:
    """The passthrough adapter dials `base_url` and refuses without one; the translated
    adapter takes the provider's own default from litellm, so it is left unset there."""
    if select_upstream(provider_key, LLMDeploymentKind.DIRECT) != "passthrough":
        return LLMEndpointRoute()
    return LLMEndpointRoute(base_url=direct_endpoint(provider_key))


def standard_llm_endpoints() -> List[LLMEndpoint]:
    """All eleven, existence-unfiltered — the service intersects with the project's
    provider keys (D20)."""
    endpoints = (
        standard_llm_endpoint(provider_key=provider_key)
        for provider_key in supported_llm_models
    )
    return [endpoint for endpoint in endpoints if endpoint is not None]
