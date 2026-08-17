"""Unit tests for auth.py's per-deployment secret presentation (specs-wp24.md Phase 1).

`_vertex_auth` mints a token via litellm's Vertex credential helper — patched here so this
stays a unit test (no real Google call, no real LLM call, per the wave's hard rule).
"""

from unittest.mock import AsyncMock, patch

import pytest

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMResolvedRoute
from oss.src.core.gateways.llms.providers.passthrough.auth import build_auth_headers
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import (
    ResolvedSecret,
    SecretOrigin,
    SecretOwner,
    SecretOwnerKind,
)
from oss.src.core.secrets.dtos import (
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


def _route(**overrides) -> LLMResolvedRoute:
    base = dict(
        provider_key="openai", deployment_kind=LLMDeploymentKind.DIRECT, model="gpt-4o"
    )
    base.update(overrides)
    return LLMResolvedRoute(**base)


def _standard_secret(key: str = "sk-standard") -> ResolvedSecret:
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.PROVIDER_KEY,
            data=StandardProviderDTO(
                kind=StandardProviderKind.OPENAI,
                provider=StandardProviderSettingsDTO(key=key),
            ),
            header=Header(name="openai"),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


def _custom_secret(key: str = "sk-custom", extras: dict = None) -> ResolvedSecret:
    data = CustomProviderDTO(
        kind=CustomProviderKind.CUSTOM,
        provider=CustomProviderSettingsDTO(key=key, extras=extras),
        models=[],
    ).model_dump()
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.CUSTOM_PROVIDER, data=data, header=Header(name="c")
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


@pytest.mark.asyncio
async def test_direct_default_is_bearer_authorization():
    headers = await build_auth_headers(
        _route(provider_key="openai"), _standard_secret("sk-1")
    )
    assert headers == {"Authorization": "Bearer sk-1"}


@pytest.mark.asyncio
async def test_direct_anthropic_uses_x_api_key_no_prefix():
    headers = await build_auth_headers(
        _route(provider_key="anthropic"), _standard_secret("sk-ant")
    )
    assert headers == {"x-api-key": "sk-ant"}


@pytest.mark.asyncio
async def test_direct_no_secret_returns_no_headers():
    headers = await build_auth_headers(_route(provider_key="openai"), None)
    assert headers == {}


@pytest.mark.asyncio
async def test_custom_merges_extras_under_bearer_authorization():
    headers = await build_auth_headers(
        _route(deployment_kind=LLMDeploymentKind.CUSTOM),
        _custom_secret("sk-c", extras={"x-org-id": "org-1"}),
    )
    assert headers == {"x-org-id": "org-1", "Authorization": "Bearer sk-c"}


@pytest.mark.asyncio
async def test_azure_uses_api_key_header_not_authorization():
    headers = await build_auth_headers(
        _route(deployment_kind=LLMDeploymentKind.AZURE), _custom_secret("sk-azure")
    )
    assert headers == {"api-key": "sk-azure"}


@pytest.mark.asyncio
async def test_azure_with_no_secret_raises():
    with pytest.raises(LLMUpstreamError):
        await build_auth_headers(_route(deployment_kind=LLMDeploymentKind.AZURE), None)


@pytest.mark.asyncio
async def test_bedrock_uses_bearer_key_from_extras():
    headers = await build_auth_headers(
        _route(deployment_kind=LLMDeploymentKind.BEDROCK),
        _custom_secret(extras={"aws_bearer_token_bedrock": "bedrock-key"}),
    )
    assert headers == {"Authorization": "Bearer bedrock-key"}


@pytest.mark.asyncio
async def test_bedrock_with_no_bearer_key_raises():
    with pytest.raises(LLMUpstreamError):
        await build_auth_headers(
            _route(deployment_kind=LLMDeploymentKind.BEDROCK),
            _custom_secret(key=None, extras=None),
        )


@pytest.mark.asyncio
async def test_vertex_mints_a_token_via_litellms_credential_helper():
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX, extras={"vertex_project": "acme"}
    )
    secret = _custom_secret(
        extras={"vertex_ai_credentials": '{"type": "service_account"}'}
    )

    with patch(
        "litellm.llms.vertex_ai.vertex_llm_base.VertexBase.get_access_token_async",
        new_callable=AsyncMock,
        return_value=("minted-token", "acme"),
    ) as mocked:
        headers = await build_auth_headers(route, secret)

    assert headers == {"Authorization": "Bearer minted-token"}
    mocked.assert_awaited_once_with(
        credentials='{"type": "service_account"}', project_id="acme"
    )


@pytest.mark.asyncio
async def test_vertex_with_no_credentials_raises_without_minting():
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX, extras={"vertex_project": "acme"}
    )
    with pytest.raises(LLMUpstreamError):
        await build_auth_headers(route, _custom_secret(extras=None))


@pytest.mark.asyncio
async def test_sagemaker_always_raises():
    with pytest.raises(LLMUpstreamError):
        await build_auth_headers(
            _route(deployment_kind=LLMDeploymentKind.SAGEMAKER), _custom_secret()
        )
