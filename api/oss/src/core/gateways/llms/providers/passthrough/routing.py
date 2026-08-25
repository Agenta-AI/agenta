"""Compose provider URLs from resolved routes without inspecting request bodies."""

from typing import Callable, Dict

from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.types import LLMUpstreamError

# Provider base URLs include any required version prefix.
_PROTOCOL_PATHS: Dict[LLMProtocol, str] = {
    LLMProtocol.CHAT_COMPLETIONS: "/chat/completions",
    LLMProtocol.RESPONSES: "/responses",
    LLMProtocol.MESSAGES: "/messages",
}

# Fixed URLs for direct providers; custom deployments supply their own base URL.
DIRECT_BASE_URLS: Dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "together_ai": "https://api.together.xyz/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "mistral": "https://api.mistral.ai/v1",
    "mistralai": "https://api.mistral.ai/v1",
    "deepinfra": "https://api.deepinfra.com/v1/openai",
    "perplexityai": "https://api.perplexity.ai",
    "minimax": "https://api.minimax.io/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "cohere": "https://api.cohere.ai/compatibility/v1",
    "anthropic": "https://api.anthropic.com/v1",
}


def _no_route(*, provider_key: str, detail: str) -> LLMUpstreamError:
    return LLMUpstreamError(provider_key=provider_key, status_code=None, detail=detail)


def _direct_url(route: LLMResolvedRoute, protocol: LLMProtocol) -> str:
    base_url = route.base_url or DIRECT_BASE_URLS.get(route.provider_key)
    if not base_url:
        raise _no_route(
            provider_key=route.provider_key,
            detail=f"provider {route.provider_key!r} has no known route",
        )
    return base_url.rstrip("/") + _PROTOCOL_PATHS[protocol]


def _custom_url(route: LLMResolvedRoute, protocol: LLMProtocol) -> str:
    if not route.base_url:
        raise _no_route(
            provider_key=route.provider_key,
            detail="custom endpoint has no base_url",
        )
    return route.base_url.rstrip("/") + _PROTOCOL_PATHS[protocol]


def _azure_url(route: LLMResolvedRoute, protocol: LLMProtocol) -> str:
    if not route.base_url:
        raise _no_route(
            provider_key=route.provider_key, detail="azure endpoint has no base_url"
        )
    # Azure uses the configured model as its deployment name.
    url = (
        f"{route.base_url.rstrip('/')}/openai/deployments/{route.model}"
        f"{_PROTOCOL_PATHS[protocol]}"
    )
    if route.api_version:
        url += f"?api-version={route.api_version}"
    return url


# Bedrock has protocol-specific paths beneath a common host.
_BEDROCK_PROTOCOL_PATHS: Dict[LLMProtocol, str] = {
    LLMProtocol.CHAT_COMPLETIONS: "/v1/chat/completions",
    LLMProtocol.RESPONSES: "/v1/responses",
    LLMProtocol.MESSAGES: "/anthropic/v1/messages",
}


def _bedrock_url(route: LLMResolvedRoute, protocol: LLMProtocol) -> str:
    base_url = route.base_url or (
        f"https://bedrock-mantle.{route.region}.api.aws" if route.region else None
    )
    if not base_url:
        raise _no_route(
            provider_key=route.provider_key,
            detail="bedrock endpoint has no region or base_url",
        )
    return base_url.rstrip("/") + _BEDROCK_PROTOCOL_PATHS[protocol]


# Vertex routes share a project and location prefix.
def _vertex_base_prefix(route: LLMResolvedRoute) -> str:
    if route.base_url:
        return route.base_url.rstrip("/")
    project = (route.extras or {}).get("vertex_project")
    if not (route.region and project):
        raise _no_route(
            provider_key=route.provider_key,
            detail="vertex endpoint needs region and extras.vertex_project (or a base_url)",
        )
    return (
        f"https://{route.region}-aiplatform.googleapis.com/v1/projects/{project}"
        f"/locations/{route.region}"
    )


def _vertex_url(route: LLMResolvedRoute, protocol: LLMProtocol) -> str:
    prefix = _vertex_base_prefix(route)
    return f"{prefix}/endpoints/openapi{_PROTOCOL_PATHS[protocol]}"


def _sagemaker_url(route: LLMResolvedRoute, protocol: LLMProtocol) -> str:  # noqa: ARG001
    # SageMaker has no fixed platform request schema.
    raise _no_route(
        provider_key=route.provider_key,
        detail="sagemaker has no fixed request protocol and is not reachable through the gateway",
    )


_ROUTING: Dict[LLMDeploymentKind, Callable[[LLMResolvedRoute, LLMProtocol], str]] = {
    LLMDeploymentKind.DIRECT: _direct_url,
    LLMDeploymentKind.CUSTOM: _custom_url,
    LLMDeploymentKind.AZURE: _azure_url,
    LLMDeploymentKind.BEDROCK: _bedrock_url,
    LLMDeploymentKind.VERTEX: _vertex_url,
    LLMDeploymentKind.SAGEMAKER: _sagemaker_url,
}


# Vertex Messages uses its Anthropic raw-predict operation.
def _vertex_messages_url(route: LLMResolvedRoute, *, stream: bool) -> str:
    if not route.model:
        raise _no_route(
            provider_key=route.provider_key,
            detail="vertex messages endpoint has no model",
        )
    prefix = _vertex_base_prefix(route)
    action = "streamRawPredict" if stream else "rawPredict"
    return f"{prefix}/publishers/anthropic/models/{route.model}:{action}"


_MESSAGES_ROUTING: Dict[LLMDeploymentKind, Callable[[LLMResolvedRoute, bool], str]] = {
    LLMDeploymentKind.VERTEX: _vertex_messages_url,
}


def build_url(
    route: LLMResolvedRoute, protocol: LLMProtocol, *, stream: bool = False
) -> str:
    if protocol == LLMProtocol.MESSAGES:
        messages_strategy = _MESSAGES_ROUTING.get(route.deployment_kind)
        if messages_strategy is not None:
            return messages_strategy(route, stream=stream)
    strategy = _ROUTING.get(route.deployment_kind)
    if strategy is None:
        raise _no_route(
            provider_key=route.provider_key,
            detail=f"no routing strategy for deployment_kind {route.deployment_kind!r}",
        )
    return strategy(route, protocol)
