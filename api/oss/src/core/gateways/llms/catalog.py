"""The generated standard-endpoint catalogue (entities.md §8, D20).

Two pure functions over the SDK's static provider->model map. A standard endpoint is
derived, never stored: no id, no `Lifecycle`, code-default `settings`. Existence for a given
project is answered by the resolver's `available_provider_keys` (R2), not by this module —
`standard_llm_endpoint` never queries a DAO or the vault.
"""

from typing import List, Optional

from agenta.sdk.utils.assets import litellm_provider_prefixes, supported_llm_models

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointData,
    LLMEndpointRoute,
    LLMModelFilter,
)
from oss.src.core.gateways.llms.providers.passthrough.routing import DIRECT_BASE_URLS
from oss.src.core.shared.dtos import Header


def _bare_model_id(*, provider_key: str, model_id: str) -> str:
    """Strip the provider's own litellm routing prefix, if the catalogued id carries one.

    litellm's `"anthropic/claude-sonnet-5"`-style ids exist for litellm's own dispatch and
    mean nothing to the upstream itself (open-designs.md OD16) — a relay that never touches
    the body must advertise the id the real upstream accepts, since fixing this at relay
    time would be the body conversion D34 forbids.
    """
    prefix = litellm_provider_prefixes.get(provider_key)
    if prefix and model_id.startswith(f"{prefix}/"):
        return model_id[len(prefix) + 1 :]
    return model_id


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
            models=LLMModelFilter(
                allowlist=[
                    _bare_model_id(provider_key=provider_key, model_id=model_id)
                    for model_id in model_slugs
                ]
            ),
        ),
    )


def _route(provider_key: str) -> LLMEndpointRoute:
    """Every DIRECT provider OD16 clears has a known base_url (open-designs.md); one absent
    from the table is one OD16 did not clear, and relaying to it fails at relay time rather
    than here — this function never raises."""
    base_url = DIRECT_BASE_URLS.get(provider_key)
    return LLMEndpointRoute(base_url=base_url) if base_url else LLMEndpointRoute()


def standard_llm_endpoints() -> List[LLMEndpoint]:
    """All eleven, existence-unfiltered — the service intersects with the project's
    provider keys (D20)."""
    endpoints = (
        standard_llm_endpoint(provider_key=provider_key)
        for provider_key in supported_llm_models
    )
    return [endpoint for endpoint in endpoints if endpoint is not None]
