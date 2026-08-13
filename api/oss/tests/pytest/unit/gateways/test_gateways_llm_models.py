"""Wire model instantiation — apis/fastapi/gateways/llms/models.py (entities.md §6).

C0-style: every model in the file constructs with representative values.
"""

from uuid import uuid4

from oss.src.apis.fastapi.gateways.llms.models import (
    LlmEndpointCreateRequest,
    LlmEndpointEditRequest,
    LlmEndpointQueryRequest,
    LlmEndpointResponse,
    LlmEndpointsResponse,
)
from oss.src.core.gateways.llms.dtos import (
    LlmDeploymentKind,
    LlmEndpoint,
    LlmEndpointCreate,
    LlmEndpointData,
    LlmEndpointEdit,
    LlmEndpointQuery,
)
from oss.src.core.shared.dtos import Windowing


def _endpoint_create() -> LlmEndpointCreate:
    return LlmEndpointCreate(
        slug="acme-openai",
        provider_key="openai",
        deployment=LlmDeploymentKind.DIRECT,
        data=LlmEndpointData(model_slugs=["gpt-4o"]),
    )


def _endpoint() -> LlmEndpoint:
    return LlmEndpoint(
        id=uuid4(),
        slug="acme-openai",
        provider_key="openai",
        deployment=LlmDeploymentKind.DIRECT,
        data=LlmEndpointData(model_slugs=["gpt-4o"]),
    )


def test_llm_endpoint_create_request_instantiates():
    request = LlmEndpointCreateRequest(endpoint=_endpoint_create())
    assert request.endpoint.provider_key == "openai"


def test_llm_endpoint_edit_request_instantiates():
    request = LlmEndpointEditRequest(
        endpoint=LlmEndpointEdit(
            id=uuid4(),
            data=LlmEndpointData(model_slugs=["gpt-4o-mini"]),
        )
    )
    assert request.endpoint.data.model_slugs == ["gpt-4o-mini"]


def test_llm_endpoint_query_request_instantiates_with_defaults():
    request = LlmEndpointQueryRequest()
    assert request.endpoint is None
    assert request.windowing is None


def test_llm_endpoint_query_request_instantiates_with_values():
    request = LlmEndpointQueryRequest(
        endpoint=LlmEndpointQuery(provider_key="openai"),
        windowing=Windowing(limit=10),
    )
    assert request.endpoint.provider_key == "openai"
    assert request.windowing.limit == 10


def test_llm_endpoint_response_instantiates():
    response = LlmEndpointResponse(count=1, endpoint=_endpoint())
    assert response.count == 1
    assert response.endpoint.slug == "acme-openai"


def test_llm_endpoint_response_instantiates_with_defaults():
    response = LlmEndpointResponse()
    assert response.count == 0
    assert response.endpoint is None


def test_llm_endpoints_response_instantiates():
    response = LlmEndpointsResponse(count=1, endpoints=[_endpoint()])
    assert response.count == 1
    assert len(response.endpoints) == 1


def test_llm_endpoints_response_default_list_is_not_shared():
    """`Field(default_factory=list)`, not a bare `[]` — mutating one instance's
    default must not leak into a sibling instance's default."""
    first = LlmEndpointsResponse()
    second = LlmEndpointsResponse()
    first.endpoints.append(_endpoint())
    assert second.endpoints == []
