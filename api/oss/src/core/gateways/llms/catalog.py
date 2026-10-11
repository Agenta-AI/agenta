"""Generate standard LLM endpoints from the provider catalogue."""

import base64
import binascii
import json
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
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import ResolvedSecret, SecretOrigin
from oss.src.core.secrets.dtos import (
    CustomModelSettingsDTO,
    CustomProviderDTO,
    CustomProviderSettingsDTO,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import CustomProviderKind, SecretKind
from oss.src.core.shared.dtos import Header
from oss.src.utils.env import env

_MOCK_MODELS = ["mock/echo", "gpt-5.5", "claude-sonnet-5"]

# The platform's own provider: Agenta's Vertex AI account.
AGENTA_PROVIDER = "agenta"

# The models `builtin/agenta` serves, spelled as Vertex's OpenAI-compatible endpoint names
# them, so a request body relays to Vertex unchanged.
AGENTA_MODELS = ("google/gemini-3.7-flash", "google/gemini-3.8-flash")

# The connection the starter-credits bridge seeded ("Agenta", slug `starter-credits`), and
# each model id a saved revision can name on it, with the `builtin/agenta` model that
# replaces it. The transfer job (`entrypoints.migrate_starter_credits_to_wallet --apply`)
# deletes the connection and moves its budget into the wallet; saved agents keep naming it,
# so the gateway resolves the alias at run time instead of a data migration rewriting their
# configs. Both spellings a custom endpoint allows are here: the qualified vault key and the
# bare model slug. Production holds no other starter-credits model.
RETIRED_STARTER_CREDITS_SLUG = "starter-credits"
RETIRED_STARTER_CREDITS_MODEL_ALIASES = {
    "Agenta/custom/vertex_ai/gemini-3.7-flash": "google/gemini-3.7-flash",
    "vertex_ai/gemini-3.7-flash": "google/gemini-3.7-flash",
}

# Fixed, not configurable: the rate card prices the `global` endpoint, and a regional one
# lists 10% higher, so another location would be charged below its cost basis.
AGENTA_VERTEX_LOCATION = "global"

# Every provider the `builtin` namespace can serve. A `builtin` call runs on the platform's
# account, so the wallet's rate card must price each model these serve.
BUILTIN_LLM_PROVIDERS = (AGENTA_PROVIDER, "mock")


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
    """A platform-funded endpoint, or None when this deployment does not serve it.

    `agenta` is the platform's own Vertex AI account, served only when its credential is
    configured. `mock` is the development stand-in, served only under the mock switch. The
    upstream credential of either is never project-owned."""
    if provider_key == AGENTA_PROVIDER:
        return _agenta_endpoint()
    if provider_key == "mock" and env.mock_gateways.enabled:
        return LLMEndpoint(
            slug="mock",
            header=Header(name="mock"),
            provider_key="mock",
            deployment_kind=LLMDeploymentKind.MOCK,
            namespace=GatewayEndpointNamespace.BUILTIN,
            data=LLMEndpointData(
                route=LLMEndpointRoute(),
                models=LLMModelFilter(allowlist=_MOCK_MODELS),
            ),
        )
    return None


def _agenta_endpoint() -> Optional[LLMEndpoint]:
    config = env.llm_gateway
    if not config.vertex_configured:
        return None
    return LLMEndpoint(
        slug=AGENTA_PROVIDER,
        header=Header(name="Agenta"),
        provider_key=AGENTA_PROVIDER,
        deployment_kind=LLMDeploymentKind.VERTEX,
        namespace=GatewayEndpointNamespace.BUILTIN,
        data=LLMEndpointData(
            route=LLMEndpointRoute(
                region=AGENTA_VERTEX_LOCATION,
                extras={"vertex_project": config.vertex_project},
            ),
            models=LLMModelFilter(allowlist=list(AGENTA_MODELS)),
        ),
    )


def builtin_llm_secret(*, provider_key: str) -> Optional[ResolvedSecret]:
    """The platform credential a `builtin` endpoint authenticates with, or None when the
    endpoint needs none (the mock).

    Built from configuration on every call rather than read from any vault: no project owns
    it, so it has no owner, and its origin is `local`, the platform's own money."""
    if provider_key != AGENTA_PROVIDER or not env.llm_gateway.vertex_configured:
        return None
    try:
        document = json.loads(base64.b64decode(env.llm_gateway.vertex_sa_json_b64))
    except (binascii.Error, ValueError) as exc:
        raise LLMUpstreamError(
            provider_key=provider_key,
            status_code=None,
            detail="AGENTA_LLM_GATEWAY_VERTEX_SA_JSON_B64 is not base64 of a JSON document",
        ) from exc
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.CUSTOM_PROVIDER,
            header=Header(name="Agenta"),
            data=CustomProviderDTO(
                kind=CustomProviderKind.VERTEX,
                provider=CustomProviderSettingsDTO(
                    extras={"vertex_ai_credentials": document}
                ),
                models=[CustomModelSettingsDTO(slug=model) for model in AGENTA_MODELS],
            ),
        ),
        owner=None,
        origin=SecretOrigin.LOCAL,
    )
