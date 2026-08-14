"""Effective model routes and credential-role classification."""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

from .errors import InvalidConnectionConfigurationError
from .models import Endpoint, GatewayCredentials, ResolvedConnection, ResolvedCredential

_DIRECT_ENDPOINTS: Dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "gemini": "https://generativelanguage.googleapis.com",
    "mistral": "https://api.mistral.ai/v1",
    "mistralai": "https://api.mistral.ai/v1",
    "minimax": "https://api.minimax.io/v1",
    "groq": "https://api.groq.com/openai/v1",
    "together_ai": "https://api.together.xyz/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}
_NON_SECRET_ENV = {
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
}
_LOCAL_USE_ENV = {
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "GOOGLE_APPLICATION_CREDENTIALS",
}


def direct_endpoint(provider: str) -> Optional[str]:
    """The registered direct base URL for a provider, or None when it has none."""
    return _DIRECT_ENDPOINTS.get(provider.lower())


def effective_endpoint(
    *,
    provider: str,
    deployment: str,
    endpoint: Optional[Endpoint],
    environment: Dict[str, str],
) -> Endpoint:
    """Return the exact HTTPS route used by this resolved provider deployment."""
    if endpoint and endpoint.base_url:
        resolved = endpoint
    elif deployment == "direct" or deployment.lower() == provider.lower():
        base_url = _DIRECT_ENDPOINTS.get(provider.lower())
        if not base_url:
            raise ValueError(
                f"no effective endpoint is registered for provider '{provider}'"
            )
        resolved = Endpoint(base_url=base_url)
    elif deployment == "bedrock":
        region = environment.get("AWS_REGION") or environment.get("AWS_DEFAULT_REGION")
        if not region:
            raise ValueError("bedrock model connection requires an AWS region")
        resolved = Endpoint(
            base_url=f"https://bedrock-runtime.{region}.amazonaws.com", region=region
        )
    elif deployment in {"vertex", "vertex_ai"}:
        location = environment.get("GOOGLE_CLOUD_LOCATION")
        if not location:
            raise ValueError("vertex model connection requires GOOGLE_CLOUD_LOCATION")
        resolved = Endpoint(
            base_url=f"https://{location}-aiplatform.googleapis.com", region=location
        )
    else:
        raise ValueError(f"deployment '{deployment}' requires an explicit endpoint")

    parsed = urlparse(resolved.base_url or "")
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError("model connection endpoint must be an absolute HTTPS URL")
    return resolved


def classify_environment(
    values: Iterable[Tuple[str, str]],
) -> Tuple[List[ResolvedCredential], Dict[str, str]]:
    """Split provider environment into secret bindings and non-secret configuration."""
    credentials: List[ResolvedCredential] = []
    environment: Dict[str, str] = {}
    for name, value in values:
        if not name or not value:
            raise ValueError(
                "model connection bindings require non-empty names and values"
            )
        if name in _NON_SECRET_ENV:
            environment[name] = value
            continue
        usage = "local_use" if name in _LOCAL_USE_ENV else "opaque_http"
        credentials.append(
            ResolvedCredential(
                binding={"kind": "environment", "name": name},
                value=value,
                usage=usage,
            )
        )
    return credentials, environment


def build_resolved_connection(
    *,
    provider: str,
    model: str,
    deployment: str = "direct",
    credential_mode: str,
    values: Dict[str, str],
    endpoint: Optional[Endpoint] = None,
    input_modalities: Optional[List[str]] = None,
) -> ResolvedConnection:
    """Build a classified connection and attach the resolver-owned effective route."""
    if deployment in {"vertex", "vertex_ai"} and values.get("GOOGLE_CLOUD_API_KEY"):
        raise InvalidConnectionConfigurationError(
            "Vertex API-key authentication is not supported by the agent connection contract"
        )
    try:
        credentials, environment = classify_environment(values.items())
    except ValueError as exc:
        # Same contract as the endpoint-resolution failure below: a malformed binding is a
        # caller configuration problem (422), never an unhandled 500.
        raise InvalidConnectionConfigurationError(str(exc)) from exc
    if credential_mode == "env" and not credentials:
        raise InvalidConnectionConfigurationError(
            "credential_mode 'env' requires at least one usable credential"
        )
    try:
        route = effective_endpoint(
            provider=provider,
            deployment=deployment,
            endpoint=endpoint,
            environment=environment,
        )
    except ValueError as exc:
        # A runtime-owned login with no resolved credential does not need a credential host.
        # Once Agenta supplies any credential, an indeterminate route is unsafe and fails loud.
        if any(credential.usage == "opaque_http" for credential in credentials):
            raise InvalidConnectionConfigurationError(str(exc)) from exc
        route = None
    return ResolvedConnection(
        provider=provider,
        model=model,
        deployment=deployment,
        credential_mode=credential_mode,
        credentials=credentials,
        environment=environment,
        endpoint=route,
        input_modalities=input_modalities,
    )


# D33/D34: only Chat Completions has a mounted front door today
# (api/oss/src/apis/fastapi/gateways/llms/proxy.py: `/standard/{provider}/v1/chat/completions`,
# `/custom/{slug}/v1/chat/completions`). Responses and Messages ship with WP23, together. A
# provider whose upstream does not speak Chat Completions has no relay to reach it through yet
# and must fail loud rather than fall back to a direct connection (D34: no body conversion, so
# there is no other way to reach it).
_CHAT_COMPLETIONS_PROVIDERS = frozenset(
    {"openai", "mistral", "mistralai", "minimax", "groq", "together_ai", "openrouter"}
)
# The two deployments a gateway route can be composed for without a stored endpoint row's own
# deployment surface (bedrock/vertex/azure need routing OD16 has not verified yet).
_GATEWAY_ROUTABLE_DEPLOYMENTS = frozenset({"direct", "custom"})


def gateway_protocol_for(*, provider: str, deployment: str) -> Optional[str]:
    """The front-door protocol this (provider, deployment) speaks, or ``None`` if unrouted.

    Deliberately conservative: only the upstreams verified OpenAI-Chat-Completions-shaped are
    routable today. Everything else needs a front door WP23 has not shipped on this branch
    (Responses, Messages) or an upstream WP24/OD16 has not cleared (bedrock, vertex, azure).
    """
    if deployment not in _GATEWAY_ROUTABLE_DEPLOYMENTS:
        return None
    if (provider or "").lower() in _CHAT_COMPLETIONS_PROVIDERS:
        return "chat_completions"
    return None


def gateway_target(*, kind: str, provider: str, slug: str) -> Tuple[str, str]:
    """The D30 ``(namespace, name)`` pair for a chosen vault candidate.

    ``provider_key`` records carry no endpoint row of their own — the gateway already knows
    the shape (D30's "generated provider set") — so they route through ``standard/{provider}``.
    ``custom_provider`` records are a stored row (their own base URL), so they route through
    ``custom/{slug}``.
    """
    if kind == "provider_key":
        return "standard", provider.lower()
    return "custom", slug


def gateway_route(*, namespace: str, name: str, gateway_base_url: str) -> str:
    """The gateway route base URL (D30): ``{gateway_base}/gateways/llms/{namespace}/{name}``.

    No protocol suffix (``/v1/chat/completions``) — that is the harness's own append, the
    same split the endpoint document already makes (entities.md §2.4).
    """
    return f"{gateway_base_url.rstrip('/')}/gateways/llms/{namespace}/{name}"


def build_gateway_resolved_connection(
    *,
    provider: str,
    model: str,
    deployment: str,
    namespace: str,
    name: str,
    gateway_base_url: str,
    gateway_credentials_value: str,
    input_modalities: Optional[List[str]] = None,
) -> ResolvedConnection:
    """Build a resolved connection that routes through the gateway (W1/D30/D31).

    No provider secret ever lands here: ``credentials`` stays empty and ``credential_mode``
    is ``none`` — the gateway holds the provider's secret, not the harness. Our own
    credentials into the gateway ride ``gateway_credentials`` (``X-AG-Credentials``), never
    ``credentials``, which stays reserved for a provider's own secret (W1).
    """
    return ResolvedConnection(
        provider=provider,
        model=model,
        deployment=deployment,
        credential_mode="none",
        credentials=[],
        endpoint=Endpoint(
            base_url=gateway_route(
                namespace=namespace, name=name, gateway_base_url=gateway_base_url
            )
        ),
        gateway_credentials=GatewayCredentials(value=gateway_credentials_value),
        input_modalities=input_modalities,
    )
