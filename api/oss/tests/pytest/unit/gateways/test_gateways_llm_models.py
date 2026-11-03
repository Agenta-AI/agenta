"""LLM gateway wire-model instantiation tests.

C0-style: every model in the file constructs with representative values.
"""

from uuid import uuid4

from oss.src.apis.fastapi.gateways.llms.models import (
    LLMEndpointCreateRequest,
    LLMEndpointEditRequest,
    LLMEndpointQueryRequest,
    LLMEndpointResponse,
    LLMEndpointsResponse,
)
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointCreate,
    LLMEndpointData,
    LLMEndpointEdit,
    LLMEndpointQuery,
    LLMModelFilter,
)
from oss.src.core.shared.dtos import Windowing


def _endpoint_create() -> LLMEndpointCreate:
    return LLMEndpointCreate(
        slug="acme-openai",
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.DIRECT,
        data=LLMEndpointData(models=LLMModelFilter(allowlist=["gpt-4o"])),
    )


def _endpoint() -> LLMEndpoint:
    return LLMEndpoint(
        id=uuid4(),
        slug="acme-openai",
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.DIRECT,
        data=LLMEndpointData(models=LLMModelFilter(allowlist=["gpt-4o"])),
    )


def test_llm_endpoint_create_request_instantiates():
    request = LLMEndpointCreateRequest(endpoint=_endpoint_create())
    assert request.endpoint.provider_key == "openai"


def test_llm_endpoint_edit_request_instantiates():
    request = LLMEndpointEditRequest(
        endpoint=LLMEndpointEdit(
            id=uuid4(),
            data=LLMEndpointData(models=LLMModelFilter(allowlist=["gpt-4o-mini"])),
        )
    )
    assert request.endpoint.data.models.allowlist == ["gpt-4o-mini"]


def test_llm_endpoint_query_request_instantiates_with_defaults():
    request = LLMEndpointQueryRequest()
    assert request.endpoint is None
    assert request.windowing is None


def test_llm_endpoint_query_request_instantiates_with_values():
    request = LLMEndpointQueryRequest(
        endpoint=LLMEndpointQuery(provider_key="openai"),
        windowing=Windowing(limit=10),
    )
    assert request.endpoint.provider_key == "openai"
    assert request.windowing.limit == 10


def test_llm_endpoint_response_instantiates():
    response = LLMEndpointResponse(count=1, endpoint=_endpoint())
    assert response.count == 1
    assert response.endpoint.slug == "acme-openai"


def test_llm_endpoint_response_instantiates_with_defaults():
    response = LLMEndpointResponse()
    assert response.count == 0
    assert response.endpoint is None


def test_llm_endpoints_response_instantiates():
    response = LLMEndpointsResponse(count=1, endpoints=[_endpoint()])
    assert response.count == 1
    assert len(response.endpoints) == 1


def test_llm_endpoints_response_default_list_is_not_shared():
    """`Field(default_factory=list)`, not a bare `[]` — mutating one instance's
    default must not leak into a sibling instance's default."""
    first = LLMEndpointsResponse()
    second = LLMEndpointsResponse()
    first.endpoints.append(_endpoint())
    assert second.endpoints == []
