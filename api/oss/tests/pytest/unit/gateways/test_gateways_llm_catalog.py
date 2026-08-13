"""Unit tests for `catalog.py` (specs-wp7.md, tasks-wp7.md Phase 1). Nothing running."""

from agenta.sdk.utils.assets import supported_llm_models

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.catalog import (
    standard_llm_endpoint,
    standard_llm_endpoints,
)
from oss.src.core.gateways.llms.dtos import LlmDeploymentKind


def test_standard_llm_endpoint_openai_matches_the_catalogue_exactly():
    endpoint = standard_llm_endpoint(provider_key="openai")

    assert endpoint is not None
    assert endpoint.namespace == GatewayEndpointNamespace.STANDARD
    assert endpoint.slug == "openai"
    assert endpoint.deployment == LlmDeploymentKind.DIRECT
    assert endpoint.data.model_slugs == supported_llm_models["openai"]
    assert endpoint.id is None
    assert endpoint.created_at is None


def test_standard_llm_endpoint_none_for_uncatalogued_standard_providers():
    for provider_key in ("anyscale", "alephalpha", "mistralai"):
        assert standard_llm_endpoint(provider_key=provider_key) is None


def test_standard_llm_endpoint_none_for_unknown_provider():
    assert standard_llm_endpoint(provider_key="not-a-provider") is None


def test_standard_llm_endpoints_returns_exactly_eleven():
    endpoints = standard_llm_endpoints()
    assert len(endpoints) == 11
    assert {endpoint.provider_key for endpoint in endpoints} == set(
        supported_llm_models.keys()
    )
