"""Build provider authentication headers without modifying request bodies."""

from typing import Callable, Coroutine, Dict, Optional, Tuple

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMResolvedRoute
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import ResolvedSecret
from oss.src.core.secrets.enums import SecretKind
from oss.src.utils.env import env

# Direct providers with non-standard authentication headers.
_DIRECT_AUTH_HEADERS: Dict[str, Tuple[str, str]] = {
    "anthropic": ("x-api-key", ""),
}
_DEFAULT_AUTH_HEADER: Tuple[str, str] = ("Authorization", "Bearer ")


def _secret_key(secret: ResolvedSecret) -> Optional[str]:
    data = secret.secret.data
    if secret.secret.kind in (SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER):
        return data.provider.key
    return None


def _secret_extras(secret: ResolvedSecret) -> dict:
    data = secret.secret.data
    if secret.secret.kind == SecretKind.CUSTOM_PROVIDER:
        return data.provider.extras or {}
    return {}


async def _direct_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    if secret is None:
        return {}
    key = _secret_key(secret)
    if not key:
        return {}
    header, prefix = _DIRECT_AUTH_HEADERS.get(route.provider_key, _DEFAULT_AUTH_HEADER)
    return {header: f"{prefix}{key}"}


async def _custom_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    if secret is None:
        return {}
    headers: Dict[str, str] = {}
    extras = _secret_extras(secret)
    if extras:
        headers.update({str(k): str(v) for k, v in extras.items()})
    key = _secret_key(secret)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


async def _azure_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    key = secret and _secret_key(secret)
    if not key:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="azure endpoint has no secret",
        )
    return {"api-key": key}


async def _bedrock_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    # Bedrock API keys are sent as bearer tokens.
    token = (secret and _secret_extras(secret).get("aws_bearer_token_bedrock")) or (
        secret and _secret_key(secret)
    )
    if not token:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="bedrock endpoint has no bearer key",
        )
    return {"Authorization": f"Bearer {token}"}


async def _vertex_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    # LiteLLM mints the Vertex access token without transforming request or response bytes.
    from litellm.llms.vertex_ai.vertex_llm_base import VertexBase

    extras = _secret_extras(secret) if secret else {}
    credentials = extras.get("vertex_ai_credentials")
    project = (route.extras or {}).get("vertex_project")
    if not credentials or not project:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="vertex endpoint needs a service-account credential and extras.vertex_project",
        )
    # The opt-in mock credential exercises the Vertex route without Google token minting.
    if env.mock_gateways.enabled and credentials == "agenta-gateway-mock":
        return {"Authorization": f"Bearer {env.mock_gateways.upstream_token}"}
    token, _project = await VertexBase().get_access_token_async(
        credentials=credentials, project_id=project
    )
    return {"Authorization": f"Bearer {token}"}


async def _sagemaker_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:  # noqa: ARG001
    raise LLMUpstreamError(
        provider_key=route.provider_key,
        status_code=None,
        detail="sagemaker has no fixed request protocol and is not reachable through the gateway",
    )


_AUTH: Dict[
    LLMDeploymentKind,
    Callable[
        [LLMResolvedRoute, Optional[ResolvedSecret]],
        Coroutine[None, None, Dict[str, str]],
    ],
] = {
    LLMDeploymentKind.DIRECT: _direct_auth,
    LLMDeploymentKind.CUSTOM: _custom_auth,
    LLMDeploymentKind.AZURE: _azure_auth,
    LLMDeploymentKind.BEDROCK: _bedrock_auth,
    LLMDeploymentKind.VERTEX: _vertex_auth,
    LLMDeploymentKind.SAGEMAKER: _sagemaker_auth,
}


async def build_auth_headers(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    strategy = _AUTH.get(route.deployment_kind)
    if strategy is None:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail=f"no auth strategy for deployment_kind {route.deployment_kind!r}",
        )
    return await strategy(route, secret)
