"""Effective model routes and credential-role classification."""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

from .errors import InvalidConnectionConfigurationError
from .models import Endpoint, ResolvedConnection, ResolvedCredential

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
) -> ResolvedConnection:
    """Build a classified connection and attach the resolver-owned effective route."""
    if deployment in {"vertex", "vertex_ai"} and values.get("GOOGLE_CLOUD_API_KEY"):
        raise InvalidConnectionConfigurationError(
            "Vertex API-key authentication is not supported by the agent connection contract"
        )
    credentials, environment = classify_environment(values.items())
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
    )
