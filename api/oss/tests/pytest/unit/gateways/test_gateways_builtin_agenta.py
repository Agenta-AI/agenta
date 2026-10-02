"""`builtin/agenta`: Gemini Flash served from the platform's own Vertex AI account.

The relay runs for real here, through `RelayLLMAdapter`, against an in-process Vertex stand-in
(`httpx.MockTransport`). Only Google's token minting is replaced.
"""

import base64
import json
from typing import List

import httpx
import pytest

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.catalog import (
    AGENTA_MODELS,
    builtin_llm_endpoint,
    builtin_llm_secret,
)
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.passthrough.adapter import (
    RelayLLMAdapter,
    _StreamUsageReader,
    _usage_from_body,
)
from oss.src.core.gateways.llms.providers.passthrough.routing import build_url
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import (
    GatewayUsage,
    PolicyDecision,
    SecretOrigin,
    SpendAdmission,
)
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env
from uuid import uuid4

_PROJECT = "agenta-test-project"
_DOCUMENT = {
    "type": "service_account",
    "project_id": _PROJECT,
    "client_email": "gateway@agenta-test-project.iam.gserviceaccount.com",
    "token_uri": "https://oauth2.googleapis.com/token",
}
_TOKEN = "ya29.platform-token"

# Bodies as Vertex's OpenAI-compatible endpoint returns them (recorded 2026-10-02 against
# gemini-3.8-flash and gemini-3.7-flash): reasoning is counted in `total_tokens` and in
# `completion_tokens_details`, but NOT in `completion_tokens`.
_GEMINI_USAGE = {
    "completion_tokens": 262,
    "completion_tokens_details": {"reasoning_tokens": 232},
    "prompt_tokens": 14,
    "total_tokens": 508,
}
_GEMINI_CACHED_USAGE = {
    "completion_tokens": 17,
    "completion_tokens_details": {"reasoning_tokens": 51},
    "prompt_tokens": 14713,
    "prompt_tokens_details": {"cached_tokens": 12256},
    "total_tokens": 14781,
}


@pytest.fixture
def vertex(monkeypatch):
    encoded = base64.b64encode(json.dumps(_DOCUMENT).encode()).decode()
    monkeypatch.setattr(env.llm_gateway, "vertex_sa_json_b64", encoded)
    monkeypatch.setattr(env.llm_gateway, "vertex_project", _PROJECT)
    monkeypatch.setattr(env.llm_gateway, "vertex_location", "global")
    monkeypatch.setattr(env.mock_gateways, "enabled", False)

    minted: List[dict] = []

    async def _mint(self, *, credentials, project_id):
        minted.append({"credentials": credentials, "project_id": project_id})
        return _TOKEN, project_id

    from litellm.llms.vertex_ai.vertex_llm_base import VertexBase

    monkeypatch.setattr(VertexBase, "get_access_token_async", _mint)
    return minted


@pytest.fixture
def no_vertex(monkeypatch):
    monkeypatch.setattr(env.llm_gateway, "vertex_sa_json_b64", None)
    monkeypatch.setattr(env.llm_gateway, "vertex_project", None)


# --- the catalogue ---------------------------------------------------------- #


def test_agenta_is_not_served_without_its_credential_even_under_the_mock_switch(
    no_vertex, monkeypatch
):
    monkeypatch.setattr(env.mock_gateways, "enabled", True)

    assert builtin_llm_endpoint(provider_key="agenta") is None
    assert builtin_llm_secret(provider_key="agenta") is None


def test_a_project_without_a_credential_document_serves_nothing(monkeypatch):
    monkeypatch.setattr(env.llm_gateway, "vertex_sa_json_b64", "e30=")
    monkeypatch.setattr(env.llm_gateway, "vertex_project", None)

    assert builtin_llm_endpoint(provider_key="agenta") is None


def test_agenta_serves_the_two_gemini_flash_models_from_vertex(vertex):
    endpoint = builtin_llm_endpoint(provider_key="agenta")

    assert endpoint is not None
    assert endpoint.namespace == GatewayEndpointNamespace.BUILTIN
    assert endpoint.deployment_kind is LLMDeploymentKind.VERTEX
    assert endpoint.data.route.region == "global"
    assert endpoint.data.route.extras == {"vertex_project": _PROJECT}
    assert endpoint.data.models.allowlist == [
        "google/gemini-3.7-flash",
        "google/gemini-3.8-flash",
    ]


def test_the_platform_credential_has_no_owner_and_spends_platform_money(vertex):
    secret = builtin_llm_secret(provider_key="agenta")

    assert secret is not None
    assert secret.owner is None
    assert secret.origin is SecretOrigin.LOCAL
    assert secret.secret.data.provider.extras == {"vertex_ai_credentials": _DOCUMENT}
    assert builtin_llm_secret(provider_key="mock") is None


def test_a_credential_that_is_not_base64_json_is_a_typed_failure(vertex, monkeypatch):
    monkeypatch.setattr(env.llm_gateway, "vertex_sa_json_b64", "not base64 json!")

    with pytest.raises(LLMUpstreamError):
        builtin_llm_secret(provider_key="agenta")


@pytest.mark.parametrize(
    "region, host",
    [
        ("global", "https://aiplatform.googleapis.com"),
        ("europe-west4", "https://europe-west4-aiplatform.googleapis.com"),
    ],
)
def test_the_vertex_route_has_no_regional_host_for_global(region, host):
    route = LLMResolvedRoute(
        deployment_kind=LLMDeploymentKind.VERTEX,
        model="google/gemini-3.8-flash",
        region=region,
        extras={"vertex_project": "p"},
    )

    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        f"{host}/v1/projects/p/locations/{region}/endpoints/openapi/chat/completions"
    )


# --- usage ------------------------------------------------------------------ #


def test_gemini_reasoning_is_measured_as_output():
    usage = _usage_from_body(
        json.dumps({"usage": _GEMINI_USAGE}).encode(), LLMProtocol.CHAT_COMPLETIONS
    )

    assert usage == GatewayUsage(input_tokens=14, output_tokens=494)


def test_gemini_cached_input_is_apart_from_fresh_input():
    usage = _usage_from_body(
        json.dumps({"usage": _GEMINI_CACHED_USAGE}).encode(),
        LLMProtocol.CHAT_COMPLETIONS,
    )

    assert usage == GatewayUsage(
        input_tokens=14713 - 12256, cache_read_tokens=12256, output_tokens=68
    )


def test_openai_reasoning_inside_completion_tokens_is_not_counted_twice():
    usage = _usage_from_body(
        json.dumps(
            {
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 50,
                    "completion_tokens_details": {"reasoning_tokens": 40},
                    "total_tokens": 60,
                }
            }
        ).encode(),
        LLMProtocol.CHAT_COMPLETIONS,
    )

    assert usage == GatewayUsage(input_tokens=10, output_tokens=50)


# --- the relay, end to end -------------------------------------------------- #


class _Policy:
    def __init__(self):
        self.records = []

    async def authorize(self, *, scope, permission, target):
        return PolicyDecision(allowed=True, permission=permission)

    async def admit(self, *, scope, target):
        return SpendAdmission(allowed=True)

    async def record(
        self, *, scope, target, decision, outcome, run_id=None, run_labels=None
    ):
        self.records.append((target, outcome))


class _NoVault:
    async def resolve(self, *, scope, ref, mode):
        raise AssertionError("a builtin call must never read the project's vault")

    async def available_provider_keys(self, *, scope):
        return set()

    async def provider_connection_by_slug(self, *, scope, slug):
        return None


class _NoRows:
    async def fetch_endpoint_by_slug(self, *, project_id, slug):
        return None

    async def query_endpoints(self, **_kwargs):
        return []


def _vertex_upstream(requests: List[httpx.Request], *, stream: bool):
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if stream:
            frames = [
                {"choices": [{"delta": {"content": "Hi"}, "index": 0}]},
                {
                    "choices": [{"delta": {}, "finish_reason": "stop", "index": 0}],
                    "usage": _GEMINI_CACHED_USAGE,
                },
            ]
            content = (
                "".join(f"data: {json.dumps(frame)}\n\n" for frame in frames)
                + "data: [DONE]\n\n"
            ).encode()
            return httpx.Response(
                200, content=content, headers={"content-type": "text/event-stream"}
            )
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": "Hi"}}],
                "usage": _GEMINI_USAGE,
            },
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


async def _relay(*, stream: bool, body: dict):
    requests: List[httpx.Request] = []
    policy = _Policy()
    service = LLMGatewayService(
        llm_endpoints_dao=_NoRows(),
        policy=policy,
        resolver=_NoVault(),
        upstream_registry=LLMUpstreamRegistry(
            adapters={
                "relay": RelayLLMAdapter(
                    client=_vertex_upstream(requests, stream=stream)
                )
            }
        ),
    )
    result = await service.relay_chat_completion(
        scope=_scope(),
        namespace=GatewayEndpointNamespace.BUILTIN,
        name="agenta",
        body=json.dumps(body).encode(),
        headers={},
    )
    received = b"".join([chunk async for chunk in result.body])
    return requests, policy.records, received


@pytest.mark.asyncio
async def test_a_call_reaches_vertex_on_the_platform_token_and_records_its_usage(
    vertex,
):
    requests, records, received = await _relay(
        stream=False,
        body={"model": "google/gemini-3.8-flash", "messages": []},
    )

    (request,) = requests
    # The egress guard pins the connection to the address it checked, so the host travels
    # in the header and the URL carries the address.
    assert request.headers["host"] == "aiplatform.googleapis.com"
    assert request.url.path == (
        "/v1/projects/agenta-test-project/locations/global/endpoints/openapi"
        "/chat/completions"
    )
    assert request.headers["authorization"] == f"Bearer {_TOKEN}"
    # A non-streaming body relays byte for byte.
    assert json.loads(request.content) == {
        "model": "google/gemini-3.8-flash",
        "messages": [],
    }
    assert vertex == [{"credentials": _DOCUMENT, "project_id": _PROJECT}]
    assert b"Hi" in received

    ((target, outcome),) = records
    assert (target.namespace, target.provider, target.model) == (
        GatewayEndpointNamespace.BUILTIN,
        "agenta",
        "google/gemini-3.8-flash",
    )
    assert outcome.usage == GatewayUsage(input_tokens=14, output_tokens=494)
    assert outcome.origin is SecretOrigin.LOCAL
    assert outcome.owner is None


@pytest.mark.asyncio
async def test_a_stream_is_asked_for_its_usage_and_records_it(vertex):
    requests, records, _received = await _relay(
        stream=True,
        body={
            "model": "google/gemini-3.7-flash",
            "stream": True,
            "stream_options": {"include_obfuscation": False},
            "messages": [],
        },
    )

    (request,) = requests
    assert json.loads(request.content)["stream_options"] == {
        "include_obfuscation": False,
        "include_usage": True,
    }
    ((_target, outcome),) = records
    assert outcome.usage == GatewayUsage(
        input_tokens=2457, cache_read_tokens=12256, output_tokens=68
    )


@pytest.mark.asyncio
async def test_a_stream_that_declines_usage_is_still_asked_for_it(vertex):
    requests, _records, _received = await _relay(
        stream=True,
        body={
            "model": "google/gemini-3.7-flash",
            "stream": True,
            "stream_options": {"include_usage": False},
            "messages": [],
        },
    )

    assert json.loads(requests[0].content)["stream_options"] == {"include_usage": True}


def test_a_stream_cut_before_its_last_frame_reports_no_usage():
    """The remaining gap: Vertex sends usage only on the final frame, so a stream cut off
    before it measures nothing. Recorded as None (unknown), never as zero."""
    reader = _StreamUsageReader(LLMProtocol.CHAT_COMPLETIONS)
    reader.feed(b'data: {"choices": [{"delta": {"content": "Hi"}}]}\n\n')
    reader.flush()

    assert reader.usage is None


@pytest.mark.asyncio
async def test_a_model_outside_the_two_is_refused(vertex):
    from oss.src.core.gateways.llms.types import LLMModelNotAllowedError

    with pytest.raises(LLMModelNotAllowedError):
        await _relay(stream=False, body={"model": "google/gemini-3.1-pro"})


@pytest.mark.asyncio
async def test_the_harness_drives_agenta_as_an_openai_compatible_route(vertex):
    service = LLMGatewayService(
        llm_endpoints_dao=_NoRows(),
        policy=_Policy(),
        resolver=_NoVault(),
        upstream_registry=LLMUpstreamRegistry(adapters={}),
    )

    resolution = await service.resolve_agent_connection(
        scope=_scope(),
        model="google/gemini-3.8-flash",
        provider_key="openai",
        connection_slug="agenta",
        connection_namespace=GatewayEndpointNamespace.BUILTIN,
    )

    assert resolution.namespace == GatewayEndpointNamespace.BUILTIN
    assert resolution.name == "agenta"
    assert resolution.provider_key == "openai"
    assert resolution.deployment_kind is LLMDeploymentKind.CUSTOM


def test_every_agenta_model_is_in_the_allowlist(vertex):
    endpoint = builtin_llm_endpoint(provider_key="agenta")

    assert tuple(endpoint.data.models.allowlist) == AGENTA_MODELS
