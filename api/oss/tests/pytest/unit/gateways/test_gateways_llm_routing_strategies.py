"""Unit tests for routing.py's per-deployment URL composition (specs-wp24.md Phase 1)."""

import pytest

from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.passthrough.routing import build_url
from oss.src.core.gateways.llms.types import LLMUpstreamError


def _route(**overrides) -> LLMResolvedRoute:
    base = dict(
        provider_key="openai", deployment_kind=LLMDeploymentKind.DIRECT, model="gpt-4o"
    )
    base.update(overrides)
    return LLMResolvedRoute(**base)


def test_direct_known_provider_uses_the_catalogued_base_url():
    route = _route(provider_key="groq")
    assert (
        build_url(route, LLMProtocol.CHAT_COMPLETIONS)
        == "https://api.groq.com/openai/v1/chat/completions"
    )


def test_direct_anthropic_uses_the_messages_door():
    route = _route(provider_key="anthropic")
    assert (
        build_url(route, LLMProtocol.MESSAGES)
        == "https://api.anthropic.com/v1/messages"
    )


def test_direct_row_base_url_overrides_the_catalogue():
    route = _route(provider_key="openai", base_url="https://proxy.example/v1")
    assert (
        build_url(route, LLMProtocol.CHAT_COMPLETIONS)
        == "https://proxy.example/v1/chat/completions"
    )


def test_direct_unknown_provider_raises_naming_it():
    route = _route(provider_key="totally-unheard-of")
    with pytest.raises(LLMUpstreamError) as excinfo:
        build_url(route, LLMProtocol.CHAT_COMPLETIONS)
    assert "totally-unheard-of" in str(excinfo.value)


def test_custom_deployment_uses_the_row_base_url():
    route = _route(
        deployment_kind=LLMDeploymentKind.CUSTOM, base_url="https://acme.internal/v1"
    )
    assert (
        build_url(route, LLMProtocol.CHAT_COMPLETIONS)
        == "https://acme.internal/v1/chat/completions"
    )


def test_custom_deployment_with_no_base_url_raises():
    route = _route(deployment_kind=LLMDeploymentKind.CUSTOM, base_url=None)
    with pytest.raises(LLMUpstreamError):
        build_url(route, LLMProtocol.CHAT_COMPLETIONS)


def test_azure_composes_deployment_path_and_api_version():
    route = _route(
        deployment_kind=LLMDeploymentKind.AZURE,
        base_url="https://acme.openai.azure.com",
        api_version="2024-10-21",
        model="gpt-4o",
    )
    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        "https://acme.openai.azure.com/openai/deployments/gpt-4o/chat/completions"
        "?api-version=2024-10-21"
    )


def test_azure_with_no_base_url_raises():
    route = _route(deployment_kind=LLMDeploymentKind.AZURE, base_url=None)
    with pytest.raises(LLMUpstreamError):
        build_url(route, LLMProtocol.CHAT_COMPLETIONS)


def test_bedrock_composes_mantle_host_from_region():
    route = _route(deployment_kind=LLMDeploymentKind.BEDROCK, region="eu-central-1")
    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        "https://bedrock-mantle.eu-central-1.api.aws/v1/chat/completions"
    )


def test_bedrock_with_no_region_or_base_url_raises():
    route = _route(deployment_kind=LLMDeploymentKind.BEDROCK, region=None)
    with pytest.raises(LLMUpstreamError):
        build_url(route, LLMProtocol.CHAT_COMPLETIONS)


def test_vertex_composes_openapi_host_from_region_and_project():
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX,
        region="europe-west4",
        extras={"vertex_project": "acme-prod"},
    )
    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        "https://europe-west4-aiplatform.googleapis.com/v1/projects/acme-prod"
        "/locations/europe-west4/endpoints/openapi/chat/completions"
    )


def test_vertex_with_no_project_raises():
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX, region="europe-west4", extras=None
    )
    with pytest.raises(LLMUpstreamError):
        build_url(route, LLMProtocol.CHAT_COMPLETIONS)


def test_bedrock_messages_door_composes_mantle_anthropic_path():
    """OD19: Bedrock's Messages door moved to bedrock-mantle. No model in the URL — it
    stays in the body untouched (static_fields.py has no BEDROCK entry any more)."""
    route = _route(
        deployment_kind=LLMDeploymentKind.BEDROCK,
        base_url="https://bedrock.example",
        model="anthropic.claude-3-5-sonnet",
    )
    assert build_url(route, LLMProtocol.MESSAGES) == (
        "https://bedrock.example/anthropic/v1/messages"
    )


def test_bedrock_messages_door_derives_mantle_host_from_region():
    route = _route(
        deployment_kind=LLMDeploymentKind.BEDROCK,
        region="eu-central-1",
        model="anthropic.claude-3-5-sonnet",
    )
    assert build_url(route, LLMProtocol.MESSAGES) == (
        "https://bedrock-mantle.eu-central-1.api.aws/anthropic/v1/messages"
    )


def test_bedrock_messages_door_stream_flag_does_not_change_the_url():
    """Mantle's Anthropic surface streams via the body's own `stream` flag, not a
    separate operation the way legacy InvokeModel named it."""
    route = _route(
        deployment_kind=LLMDeploymentKind.BEDROCK,
        base_url="https://bedrock.example",
        model="anthropic.claude-3-5-sonnet",
    )
    assert build_url(route, LLMProtocol.MESSAGES, stream=True) == build_url(
        route, LLMProtocol.MESSAGES, stream=False
    )


def test_bedrock_messages_door_with_no_region_or_base_url_raises():
    route = _route(deployment_kind=LLMDeploymentKind.BEDROCK, region=None)
    with pytest.raises(LLMUpstreamError):
        build_url(route, LLMProtocol.MESSAGES)


def test_bedrock_base_url_is_a_host_override_shared_by_every_door():
    """OD19: base_url on a BEDROCK row is a pure host override; each door appends its own
    tail on top of it, and one stored value composes correctly on all three."""
    route = _route(
        deployment_kind=LLMDeploymentKind.BEDROCK, base_url="https://vpce.example"
    )
    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        "https://vpce.example/v1/chat/completions"
    )
    assert (
        build_url(route, LLMProtocol.RESPONSES) == "https://vpce.example/v1/responses"
    )
    assert build_url(route, LLMProtocol.MESSAGES) == (
        "https://vpce.example/anthropic/v1/messages"
    )


def test_bedrock_chat_completions_door_is_unaffected_by_the_messages_door():
    route = _route(deployment_kind=LLMDeploymentKind.BEDROCK, region="eu-central-1")
    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        "https://bedrock-mantle.eu-central-1.api.aws/v1/chat/completions"
    )


def test_vertex_messages_door_composes_raw_predict_path():
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX,
        base_url="https://vertex.example/v1/projects/acme/locations/europe-west4",
        model="claude-3-5-sonnet",
    )
    assert build_url(route, LLMProtocol.MESSAGES) == (
        "https://vertex.example/v1/projects/acme/locations/europe-west4/"
        "publishers/anthropic/models/claude-3-5-sonnet:rawPredict"
    )


def test_vertex_messages_door_streaming_uses_stream_raw_predict():
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX,
        base_url="https://vertex.example/v1/projects/acme/locations/europe-west4",
        model="claude-3-5-sonnet",
    )
    assert build_url(route, LLMProtocol.MESSAGES, stream=True) == (
        "https://vertex.example/v1/projects/acme/locations/europe-west4/publishers/anthropic/models"
        "/claude-3-5-sonnet:streamRawPredict"
    )


def test_vertex_messages_door_derives_project_host_from_region_and_project():
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX,
        region="europe-west4",
        extras={"vertex_project": "acme-prod"},
        model="claude-3-5-sonnet",
    )
    assert build_url(route, LLMProtocol.MESSAGES) == (
        "https://europe-west4-aiplatform.googleapis.com/v1/projects/acme-prod"
        "/locations/europe-west4/publishers/anthropic/models/claude-3-5-sonnet:rawPredict"
    )


def test_vertex_messages_door_with_no_model_raises_naming_vertex():
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX,
        base_url="https://v.example/v1/projects/acme/locations/europe-west4",
    )
    route.model = ""
    with pytest.raises(LLMUpstreamError):
        build_url(route, LLMProtocol.MESSAGES)


def test_vertex_chat_completions_door_is_unaffected_by_the_messages_strategy():
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX,
        region="europe-west4",
        extras={"vertex_project": "acme-prod"},
    )
    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        "https://europe-west4-aiplatform.googleapis.com/v1/projects/acme-prod"
        "/locations/europe-west4/endpoints/openapi/chat/completions"
    )


def test_vertex_base_url_is_host_plus_shared_prefix_serving_both_doors():
    """OD19: base_url on a VERTEX row is the host plus the shared
    /v1/projects/{project}/locations/{region} prefix; each door appends only its own tail,
    so one stored value serves both."""
    route = _route(
        deployment_kind=LLMDeploymentKind.VERTEX,
        base_url="https://priv.example/v1/projects/acme-prod/locations/europe-west4",
        model="claude-3-5-sonnet",
    )
    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        "https://priv.example/v1/projects/acme-prod/locations/europe-west4"
        "/endpoints/openapi/chat/completions"
    )
    assert build_url(route, LLMProtocol.MESSAGES) == (
        "https://priv.example/v1/projects/acme-prod/locations/europe-west4"
        "/publishers/anthropic/models/claude-3-5-sonnet:rawPredict"
    )


def test_sagemaker_always_raises_naming_the_reason():
    route = _route(deployment_kind=LLMDeploymentKind.SAGEMAKER, region="us-east-1")
    with pytest.raises(LLMUpstreamError) as excinfo:
        build_url(route, LLMProtocol.CHAT_COMPLETIONS)
    assert "sagemaker" in (excinfo.value.detail or "").lower()
