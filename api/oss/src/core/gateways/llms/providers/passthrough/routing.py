"""Routing strategies (D34, OD16): compose a URL from route fields, never from the body.

One function per `deployment_kind`. Each raises `LLMUpstreamError` rather than guess when a
route lacks what it needs — the failure names the provider so the caller can fix the
endpoint, and it happens before any I/O.
"""

from typing import Callable, Dict

from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.types import LLMUpstreamError

# Each provider's own version segment lives in its base_url, matching the mock upstream's
# mount (`providers/mock/app.py`: `/v1/chat/completions`, `/v1/responses`, `/v1/messages`,
# all root-relative) — every base_url below already ends where its protocol path begins, so
# `MESSAGES` is "/messages", not "/v1/messages": Anthropic's own base_url carries the `/v1`.
_PROTOCOL_PATHS: Dict[LLMProtocol, str] = {
    LLMProtocol.CHAT_COMPLETIONS: "/chat/completions",
    LLMProtocol.RESPONSES: "/responses",
    LLMProtocol.MESSAGES: "/messages",
}

# provider_key -> fixed base URL for a DIRECT deployment whose wire needs no per-row
# configuration (open-designs.md OD16). Every entry but `anthropic` is an OpenAI-compatible
# endpoint the provider publishes itself; `anthropic` is its own native Messages wire, which
# is exactly what the Messages front door relays.
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
            detail=f"provider {route.provider_key!r} has no known route (OD16 did not clear it)",
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
    # `route.model` is the deployment name (entities.md §2.4's Azure example carries no
    # separate deployment field).
    url = (
        f"{route.base_url.rstrip('/')}/openai/deployments/{route.model}"
        f"{_PROTOCOL_PATHS[protocol]}"
    )
    if route.api_version:
        url += f"?api-version={route.api_version}"
    return url


def _bedrock_url(route: LLMResolvedRoute, protocol: LLMProtocol) -> str:
    base_url = route.base_url or (
        f"https://bedrock-mantle.{route.region}.api.aws/v1" if route.region else None
    )
    if not base_url:
        raise _no_route(
            provider_key=route.provider_key,
            detail="bedrock endpoint has no region or base_url",
        )
    return base_url.rstrip("/") + _PROTOCOL_PATHS[protocol]


def _vertex_url(route: LLMResolvedRoute, protocol: LLMProtocol) -> str:
    if route.base_url:
        base_url = route.base_url
    else:
        project = (route.extras or {}).get("vertex_project")
        if not (route.region and project):
            raise _no_route(
                provider_key=route.provider_key,
                detail="vertex endpoint needs region and extras.vertex_project (or a base_url)",
            )
        base_url = (
            f"https://{route.region}-aiplatform.googleapis.com/v1/projects/{project}"
            f"/locations/{route.region}/endpoints/openapi"
        )
    return base_url.rstrip("/") + _PROTOCOL_PATHS[protocol]


def _sagemaker_url(route: LLMResolvedRoute, protocol: LLMProtocol) -> str:  # noqa: ARG001
    # OD16: SageMaker has no platform-level request schema — InvokeEndpoint forwards
    # opaque bytes to whatever container the customer deployed. Unreachable, deliberately.
    raise _no_route(
        provider_key=route.provider_key,
        detail="sagemaker has no fixed request protocol (OD16); not reachable through the gateway",
    )


_ROUTING: Dict[LLMDeploymentKind, Callable[[LLMResolvedRoute, LLMProtocol], str]] = {
    LLMDeploymentKind.DIRECT: _direct_url,
    LLMDeploymentKind.CUSTOM: _custom_url,
    LLMDeploymentKind.AZURE: _azure_url,
    LLMDeploymentKind.BEDROCK: _bedrock_url,
    LLMDeploymentKind.VERTEX: _vertex_url,
    LLMDeploymentKind.SAGEMAKER: _sagemaker_url,
}


# D40: the Messages door reaches Bedrock/Vertex through the real resold-Anthropic
# operation (InvokeModel, rawPredict), not the OpenAI-compatible door `_bedrock_url` and
# `_vertex_url` above compose — those two stay exactly as they are for the other doors.
def _bedrock_messages_url(route: LLMResolvedRoute, *, stream: bool) -> str:
    if not route.model:
        raise _no_route(
            provider_key=route.provider_key,
            detail="bedrock messages endpoint has no model",
        )
    base_url = route.base_url or (
        f"https://bedrock-runtime.{route.region}.amazonaws.com"
        if route.region
        else None
    )
    if not base_url:
        raise _no_route(
            provider_key=route.provider_key,
            detail="bedrock endpoint has no region or base_url",
        )
    action = "invoke-with-response-stream" if stream else "invoke"
    return f"{base_url.rstrip('/')}/model/{route.model}/{action}"


def _vertex_messages_url(route: LLMResolvedRoute, *, stream: bool) -> str:
    if not route.model:
        raise _no_route(
            provider_key=route.provider_key,
            detail="vertex messages endpoint has no model",
        )
    if route.base_url:
        base_url = route.base_url
    else:
        project = (route.extras or {}).get("vertex_project")
        if not (route.region and project):
            raise _no_route(
                provider_key=route.provider_key,
                detail="vertex endpoint needs region and extras.vertex_project (or a base_url)",
            )
        base_url = (
            f"https://{route.region}-aiplatform.googleapis.com/v1/projects/{project}"
            f"/locations/{route.region}"
        )
    action = "streamRawPredict" if stream else "rawPredict"
    return f"{base_url.rstrip('/')}/publishers/anthropic/models/{route.model}:{action}"


_MESSAGES_ROUTING: Dict[LLMDeploymentKind, Callable[[LLMResolvedRoute, bool], str]] = {
    LLMDeploymentKind.BEDROCK: _bedrock_messages_url,
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
