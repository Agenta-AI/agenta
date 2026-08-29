"""Generate standard LLM endpoints from the provider catalogue."""

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
from oss.src.utils.env import env

_MOCK_MODELS = ["mock/echo", "gpt-5.5", "claude-sonnet-5"]


def _bare_model_id(*, provider_key: str, model_id: str) -> str:
    """Remove a provider routing prefix from a catalogued model id."""
    prefix = litellm_provider_prefixes.get(provider_key)
    if prefix and model_id.startswith(f"{prefix}/"):
        return model_id[len(prefix) + 1 :]
    return model_id


def standard_llm_endpoint(*, provider_key: str) -> Optional[LLMEndpoint]:
    """The generated endpoint for one provider, or None when `provider_key` has no
    entry in `supported_llm_models` — covers both an unknown string and the three
    `StandardProviderKind` members with no catalogue entry (`anyscale`, `alephalpha`,
    `mistralai`)."""
    if provider_key == "mock" and env.mock_gateways.enabled:
        return LLMEndpoint(
            slug="mock",
            header=Header(name="mock"),
            provider_key="mock",
            deployment_kind=LLMDeploymentKind.MOCK,
            namespace=GatewayEndpointNamespace.STANDARD,
            data=LLMEndpointData(
                route=LLMEndpointRoute(),
                models=LLMModelFilter(allowlist=_MOCK_MODELS),
            ),
        )

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
    """Return the route for a direct provider."""
    base_url = DIRECT_BASE_URLS.get(provider_key)
    return LLMEndpointRoute(base_url=base_url) if base_url else LLMEndpointRoute()


def standard_llm_endpoints() -> List[LLMEndpoint]:
    """Return all generated standard endpoints."""
    endpoints = (
        standard_llm_endpoint(provider_key=provider_key)
        for provider_key in supported_llm_models
    )
    generated = [endpoint for endpoint in endpoints if endpoint is not None]
    mock = standard_llm_endpoint(provider_key="mock")
    return ([mock] if mock is not None else []) + generated


def builtin_llm_endpoint(*, provider_key: str) -> Optional[LLMEndpoint]:
    """Platform-owned development models.  These are generated only under the
    explicit switch; their static upstream credential is never project-owned."""
    if not env.mock_gateways.enabled or provider_key not in {"agenta", "mock"}:
        return None

    return LLMEndpoint(
        slug=provider_key,
        header=Header(name=provider_key),
        provider_key=provider_key,
        deployment_kind=LLMDeploymentKind.MOCK,
        namespace=GatewayEndpointNamespace.BUILTIN,
        data=LLMEndpointData(
            route=LLMEndpointRoute(),
            models=LLMModelFilter(allowlist=_MOCK_MODELS),
        ),
    )
