"""Unit tests for `TranslatedLlmAdapter` (specs-wp7.md, tasks-wp7.md Phase 3).

`litellm.acompletion` is monkeypatched at the module boundary — no real network call.
"""

import json
from types import SimpleNamespace

import pytest

from oss.src.core.gateways.llms.dtos import (
    LlmCallContext,
    LlmDeploymentKind,
    LlmResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import LlmRelayResult
from oss.src.core.gateways.llms.providers.translated import adapter as adapter_module
from oss.src.core.gateways.llms.providers.translated.adapter import TranslatedLlmAdapter
from oss.src.core.gateways.llms.types import LlmUpstreamError
from oss.src.core.gateways.policy.dtos import (
    SecretOwner,
    SecretOwnerKind,
    ResolvedSecret,
    SecretOrigin,
)
from oss.src.core.secrets.dtos import (
    CustomModelSettingsDTO,
    CustomProviderDTO,
    CustomProviderSettingsDTO,
    SecretResponseDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import (
    CustomProviderKind,
    SecretKind,
    StandardProviderKind,
)
from oss.src.core.shared.dtos import Header


def _body(**overrides):
    payload = {"model": "placeholder", "messages": [{"role": "user", "content": "hi"}]}
    payload.update(overrides)
    return json.dumps(payload).encode()


def _standard_secret(*, kind=StandardProviderKind.ANTHROPIC, key="sk-test"):
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.PROVIDER_KEY,
            data=StandardProviderDTO(
                kind=kind, provider=StandardProviderSettingsDTO(key=key)
            ),
            header=Header(name=kind.value),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


def _custom_secret(*, extras):
    # SecretResponseDTO's own `build_up_model_keys` validator runs before the base
    # SecretDTO validator would otherwise dict-ify `data` — pass a dict directly here so
    # its `.get("models")` scan doesn't hit a CustomProviderDTO instance.
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.CUSTOM_PROVIDER,
            data=CustomProviderDTO(
                kind=CustomProviderKind.BEDROCK,
                provider=CustomProviderSettingsDTO(key="ak", extras=extras),
                models=[CustomModelSettingsDTO(slug="claude-3")],
            ).model_dump(),
            header=Header(name="acme-bedrock"),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


class _MockUsage:
    def __init__(self, prompt_tokens=10, completion_tokens=5):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens


class _MockModelResponse:
    def __init__(self, *, usage=None, hidden_params=None):
        self.usage = usage
        self._hidden_params = hidden_params or {}

    def model_dump_json(self) -> str:
        return json.dumps(
            {"choices": [{"message": {"role": "assistant", "content": "hi"}}]}
        )


def _mock_acompletion(monkeypatch, *, response=None, exc=None, capture=None):
    async def _mock(**kwargs):
        if capture is not None:
            capture.update(kwargs)
        if exc is not None:
            raise exc
        return response

    monkeypatch.setattr(adapter_module.litellm, "acompletion", _mock)


@pytest.mark.asyncio
async def test_standard_provider_secret_passes_api_key(monkeypatch):
    capture = {}
    _mock_acompletion(
        monkeypatch,
        response=_MockModelResponse(usage=_MockUsage()),
        capture=capture,
    )

    route = LlmResolvedRoute(
        provider_key="anthropic",
        deployment=LlmDeploymentKind.DIRECT,
        model="anthropic/x",
    )
    result = await TranslatedLlmAdapter().relay_chat_completion(
        route=route,
        secret=_standard_secret(key="sk-abc"),
        context=LlmCallContext(model="anthropic/x"),
        body=_body(),
        headers={},
    )

    assert isinstance(result, LlmRelayResult)
    assert capture["api_key"] == "sk-abc"
    assert capture["model"] == "anthropic/x"


@pytest.mark.asyncio
async def test_custom_provider_secret_merges_extras(monkeypatch):
    capture = {}
    _mock_acompletion(
        monkeypatch, response=_MockModelResponse(usage=_MockUsage()), capture=capture
    )

    route = LlmResolvedRoute(
        provider_key="acme", deployment=LlmDeploymentKind.BEDROCK, model="claude-3"
    )
    await TranslatedLlmAdapter().relay_chat_completion(
        route=route,
        secret=_custom_secret(extras={"aws_access_key_id": "AKIA123"}),
        context=LlmCallContext(model="claude-3"),
        body=_body(),
        headers={},
    )

    assert capture["aws_access_key_id"] == "AKIA123"


@pytest.mark.asyncio
async def test_azure_deployment_prefixes_model_and_passes_api_version(monkeypatch):
    capture = {}
    _mock_acompletion(
        monkeypatch, response=_MockModelResponse(usage=_MockUsage()), capture=capture
    )

    route = LlmResolvedRoute(
        provider_key="acme",
        deployment=LlmDeploymentKind.AZURE,
        model="gpt-4o",
        api_version="2026-01-01",
    )
    await TranslatedLlmAdapter().relay_chat_completion(
        route=route,
        secret=None,
        context=LlmCallContext(model="gpt-4o"),
        body=_body(),
        headers={},
    )

    assert capture["model"] == "azure/gpt-4o"
    assert capture["api_version"] == "2026-01-01"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "deployment, region_kwarg",
    [
        (LlmDeploymentKind.BEDROCK, "aws_region_name"),
        (LlmDeploymentKind.VERTEX, "vertex_location"),
    ],
)
async def test_bedrock_and_vertex_pass_region(monkeypatch, deployment, region_kwarg):
    capture = {}
    _mock_acompletion(
        monkeypatch, response=_MockModelResponse(usage=_MockUsage()), capture=capture
    )

    route = LlmResolvedRoute(
        provider_key="acme", deployment=deployment, model="a-model", region="us-east-1"
    )
    await TranslatedLlmAdapter().relay_chat_completion(
        route=route,
        secret=None,
        context=LlmCallContext(model="a-model"),
        body=_body(),
        headers={},
    )

    assert capture[region_kwarg] == "us-east-1"


@pytest.mark.asyncio
async def test_litellm_exception_becomes_llm_upstream_error(monkeypatch):
    import litellm.exceptions as le

    _mock_acompletion(
        monkeypatch,
        exc=le.RateLimitError(message="boom", llm_provider="openai", model="gpt-4o"),
    )

    route = LlmResolvedRoute(
        provider_key="openai", deployment=LlmDeploymentKind.DIRECT, model="gpt-4o"
    )
    with pytest.raises(LlmUpstreamError) as excinfo:
        await TranslatedLlmAdapter().relay_chat_completion(
            route=route,
            secret=None,
            context=LlmCallContext(model="gpt-4o"),
            body=_body(),
            headers={},
        )

    assert excinfo.value.provider_key == "openai"
    assert excinfo.value.status_code == 429


@pytest.mark.asyncio
async def test_usage_and_cost_populated_on_success(monkeypatch):
    _mock_acompletion(
        monkeypatch,
        response=_MockModelResponse(
            usage=_MockUsage(prompt_tokens=100, completion_tokens=50),
            hidden_params={"response_cost": 0.0042},
        ),
    )

    route = LlmResolvedRoute(
        provider_key="openai", deployment=LlmDeploymentKind.DIRECT, model="gpt-4o"
    )
    result = await TranslatedLlmAdapter().relay_chat_completion(
        route=route,
        secret=None,
        context=LlmCallContext(model="gpt-4o"),
        body=_body(),
        headers={},
    )
    chunks = [chunk async for chunk in result.body]

    assert len(chunks) == 1
    assert result.usage is not None
    assert result.usage.input_tokens == 100
    assert result.usage.output_tokens == 50
    assert result.usage.cost == 0.0042


@pytest.mark.asyncio
async def test_streaming_wraps_chunks_as_sse_and_terminates_with_done(monkeypatch):
    async def _chunks():
        yield SimpleNamespace(
            usage=None,
            model_dump_json=lambda: json.dumps(
                {"choices": [{"delta": {"content": "hi"}}]}
            ),
        )
        yield SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=3, completion_tokens=2),
            model_dump_json=lambda: json.dumps({"choices": [{"delta": {}}]}),
        )

    _mock_acompletion(monkeypatch, response=_chunks())

    route = LlmResolvedRoute(
        provider_key="anthropic",
        deployment=LlmDeploymentKind.DIRECT,
        model="anthropic/x",
    )
    result = await TranslatedLlmAdapter().relay_chat_completion(
        route=route,
        secret=None,
        context=LlmCallContext(model="anthropic/x", stream=True),
        body=_body(stream=True),
        headers={},
    )
    chunks = [chunk async for chunk in result.body]

    assert chunks[-1] == b"data: [DONE]\n\n"
    assert all(chunk.startswith(b"data: ") for chunk in chunks[:-1])
    assert result.usage is not None
    assert result.usage.input_tokens == 3
    assert result.usage.output_tokens == 2
