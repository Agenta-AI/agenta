"""`TranslatedLlmAdapter` — the litellm-mediated south port (entities.md §7.1, §8).

For providers whose native wire differs from OpenAI's, and for cloud resellers whose auth
is request signing: the routing library earns its place here (D9), and byte-for-byte is
impossible by the upstream's own definition, so this adapter alone parses `body` instead of
relaying it untouched.
"""

import json
from typing import Any, AsyncIterator, Dict, Optional

import litellm
import openai

from oss.src.core.gateways.llms.dtos import (
    LlmCallContext,
    LlmDeploymentKind,
    LlmResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import LlmRelayResult, LlmUpstreamInterface
from oss.src.core.gateways.llms.types import LlmUpstreamError
from oss.src.core.gateways.policy.dtos import GatewayUsage, ResolvedSecret
from oss.src.core.secrets.dtos import CustomProviderDTO, StandardProviderDTO
from oss.src.core.secrets.enums import SecretKind

# route.deployment -> litellm's model prefix. DIRECT non-OpenAI-shaped providers carry
# their prefix already, from the catalogue (e.g. "anthropic/claude-...").
_DEPLOYMENT_PREFIXES = {
    LlmDeploymentKind.AZURE: "azure",
    LlmDeploymentKind.BEDROCK: "bedrock",
    LlmDeploymentKind.SAGEMAKER: "sagemaker",
    LlmDeploymentKind.VERTEX: "vertex_ai",
}

_BODY_PASSTHROUGH_EXCLUDED_KEYS = {"model", "stream"}


def _prefixed_model(route: LlmResolvedRoute) -> str:
    prefix = _DEPLOYMENT_PREFIXES.get(route.deployment)
    return f"{prefix}/{route.model}" if prefix else route.model


def _secret_kwargs(secret: Optional[ResolvedSecret]) -> Dict[str, Any]:
    """Mirrors `SecretsManager.get_provider_settings` STEP 4 exactly
    (`sdks/python/agenta/sdk/managers/secrets.py`): a `provider_key` secret contributes
    `api_key`; a `custom_provider` secret contributes its `extras`, merged verbatim."""
    if secret is None:
        return {}

    data = secret.secret.data
    if secret.secret.kind == SecretKind.PROVIDER_KEY and isinstance(
        data, StandardProviderDTO
    ):
        return {"api_key": data.provider.key}
    if secret.secret.kind == SecretKind.CUSTOM_PROVIDER and isinstance(
        data, CustomProviderDTO
    ):
        return dict(data.provider.extras or {})
    return {}


def _route_kwargs(route: LlmResolvedRoute) -> Dict[str, Any]:
    """`api_version` and `region` come from the route, never the secret (§7.1)."""
    kwargs: Dict[str, Any] = {}
    if route.deployment == LlmDeploymentKind.AZURE and route.api_version:
        kwargs["api_version"] = route.api_version
    if route.deployment == LlmDeploymentKind.BEDROCK and route.region:
        kwargs["aws_region_name"] = route.region
    if route.deployment == LlmDeploymentKind.VERTEX and route.region:
        kwargs["vertex_location"] = route.region
    extra_headers = {**(route.headers or {}), **(route.config.extra_headers or {})}
    if extra_headers:
        kwargs["extra_headers"] = extra_headers
    return kwargs


def _body_kwargs(body: bytes) -> Dict[str, Any]:
    """Parsed request parameters, minus the two this adapter sets itself. This adapter is
    the one south-port implementation exempt from byte-for-byte (§7.1): the library takes
    parsed parameters and re-serializes."""
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        payload = {}
    if not isinstance(payload, dict):
        return {}
    return {
        k: v for k, v in payload.items() if k not in _BODY_PASSTHROUGH_EXCLUDED_KEYS
    }


def _usage_from_response(response: Any, *, model: str) -> GatewayUsage:
    usage = getattr(response, "usage", None)
    input_tokens = getattr(usage, "prompt_tokens", None) if usage else None
    output_tokens = getattr(usage, "completion_tokens", None) if usage else None

    hidden_params = getattr(response, "_hidden_params", None) or {}
    cost = hidden_params.get("response_cost")
    if cost is None and input_tokens is not None and output_tokens is not None:
        try:
            input_cost, output_cost = litellm.cost_calculator.cost_per_token(
                model=model,
                prompt_tokens=input_tokens,
                completion_tokens=output_tokens,
            )
            cost = input_cost + output_cost
        except (
            Exception
        ):  # cost data missing for this model — leave unknown, never guess
            cost = None

    return GatewayUsage(
        calls=1, input_tokens=input_tokens, output_tokens=output_tokens, cost=cost
    )


def _sse(payload_json: str) -> bytes:
    return f"data: {payload_json}\n\n".encode()


class TranslatedLlmAdapter(LlmUpstreamInterface):
    """Calls `litellm.acompletion` in-process. `secret` is None only for a NONE-scheme
    target; litellm then relies on whatever ambient provider config (if any) is configured
    for the process, same as an unauthenticated call to any other adapter."""

    async def relay_chat_completion(
        self,
        *,
        route: LlmResolvedRoute,
        secret: Optional[ResolvedSecret],
        #
        context: LlmCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> LlmRelayResult:
        model = _prefixed_model(route)
        kwargs = _body_kwargs(body)
        kwargs.update(_secret_kwargs(secret))
        kwargs.update(_route_kwargs(route))
        if context.stream:
            # Trailing usage frame, mirroring the OpenAI stream's own convention
            # (LlmRelayResult's docstring) — without it litellm reports no usage at all.
            kwargs.setdefault("stream_options", {"include_usage": True})

        try:
            response = await litellm.acompletion(
                model=model, stream=context.stream, **kwargs
            )
        except openai.OpenAIError as exc:
            raise LlmUpstreamError(
                provider_key=route.provider_key,
                status_code=getattr(exc, "status_code", None),
                detail=str(exc),
            ) from exc

        result = LlmRelayResult(
            status_code=200,
            headers={
                "content-type": (
                    "text/event-stream" if context.stream else "application/json"
                )
            },
            body=_empty_body(),
        )

        if context.stream:
            result.body = _stream_body(response, result=result, model=model)
        else:
            result.body = _single_body(response, result=result, model=model)

        return result


async def _empty_body() -> AsyncIterator[bytes]:
    return
    yield b""  # pragma: no cover — placeholder, makes this an async generator


async def _single_body(
    response: Any, *, result: LlmRelayResult, model: str
) -> AsyncIterator[bytes]:
    yield response.model_dump_json().encode()
    result.usage = _usage_from_response(response, model=model)


async def _stream_body(
    stream: Any, *, result: LlmRelayResult, model: str
) -> AsyncIterator[bytes]:
    usage_response = None
    async for chunk in stream:
        if getattr(chunk, "usage", None) is not None:
            usage_response = chunk
        yield _sse(chunk.model_dump_json())
    yield b"data: [DONE]\n\n"
    result.usage = (
        _usage_from_response(usage_response, model=model)
        if usage_response is not None
        else GatewayUsage(calls=1)
    )
