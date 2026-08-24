"""Unit tests for `catalog.py` (specs-wp7.md, tasks-wp7.md Phase 1). Nothing running."""

from agenta.sdk.utils.assets import supported_llm_models

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.catalog import (
    standard_llm_endpoint,
    standard_llm_endpoints,
)
from oss.src.core.gateways.llms.dtos import LLMDeploymentKind
from oss.src.utils.env import env


def test_standard_llm_endpoint_openai_matches_the_catalogue_exactly():
    endpoint = standard_llm_endpoint(provider_key="openai")

    assert endpoint is not None
    assert endpoint.namespace == GatewayEndpointNamespace.STANDARD
    assert endpoint.slug == "openai"
    assert endpoint.deployment_kind == LLMDeploymentKind.DIRECT
    assert endpoint.data.models.allowlist == supported_llm_models["openai"]
    assert endpoint.id is None
    assert endpoint.created_at is None


def test_standard_llm_endpoint_none_for_uncatalogued_standard_providers():
    for provider_key in ("anyscale", "alephalpha", "mistralai"):
        assert standard_llm_endpoint(provider_key=provider_key) is None


def test_standard_llm_endpoint_none_for_unknown_provider():
    assert standard_llm_endpoint(provider_key="not-a-provider") is None


def test_standard_llm_endpoints_reflects_the_development_mock_switch():
    endpoints = standard_llm_endpoints()
    expected_provider_keys = set(supported_llm_models.keys())
    if env.mock_gateways.enabled:
        expected_provider_keys.add("mock")

    assert len(endpoints) == len(expected_provider_keys)
    assert {endpoint.provider_key for endpoint in endpoints} == expected_provider_keys
