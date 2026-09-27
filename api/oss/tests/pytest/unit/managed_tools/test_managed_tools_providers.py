"""The REST and MCP providers: one common result shape, one dispatch per call, and no
credential in anything the model can read."""

import json
from uuid import uuid4

import httpx
import pytest

from oss.src.core.gateways.mcps.dtos import MCPDirectAuth, MCPResolvedRoute
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult
from oss.src.core.gateways.mcps.types import MCPUpstreamError
from oss.src.core.managed_tools.mock.mcp_upstream import (
    MOCK_MCP_URL,
    MockManagedMCPUpstream,
)
from oss.src.core.managed_tools.mock.providers import build_mock_providers
from oss.src.core.gateways.policy.dtos import (
    ResolvedSecret,
    SecretOrigin,
    SecretOwner,
    SecretOwnerKind,
)
from oss.src.core.managed_tools.providers.mcp import (
    MCPActionOutcomeUnknownError,
    MCPActionProvider,
)
from oss.src.core.secrets.dtos import (
    CustomSecretDTO,
    CustomSecretFormat,
    CustomSecretSettingsDTO,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.shared.dtos import Header
from oss.src.core.managed_tools.providers.rest import RestActionProvider
from oss.src.core.managed_tools.types import ManagedActionNotSentError
from oss.tests.pytest.unit.managed_tools.fakes import context

KEY = "platform-key-0123456789abcdef"


def _rest(handler):
    requests = []

    def record(request):
        requests.append(request)
        return handler(request)

    provider = RestActionProvider(
        name="acme_rest",
        base_url="https://api.acme.example/v1",
        credential_header="x-api-key",
        credential=KEY,
        transport=httpx.MockTransport(record),
    )
    return provider, requests


async def _invoke(provider, operation="people/enrich", arguments=None):
    return await provider.invoke(
        operation=operation,
        arguments=arguments or {"email": "a@b.co"},
        context=context(execution_id="tool_1"),
    )


# --- REST ------------------------------------------------------------------------------ #


async def test_rest_sends_the_key_the_arguments_and_the_execution_id():
    provider, requests = _rest(
        lambda request: httpx.Response(
            200, json={"ok": True}, headers={"x-request-id": "r-1"}
        )
    )

    response = await _invoke(provider)

    assert response.output == {"ok": True}
    assert response.provider_reference == "r-1"
    [request] = requests
    assert str(request.url) == "https://api.acme.example/v1/people/enrich"
    assert request.headers["x-api-key"] == KEY
    assert request.headers["idempotency-key"] == "tool_1"
    assert json.loads(request.content) == {"email": "a@b.co"}


@pytest.mark.parametrize(
    "status, kind",
    [
        (429, "rate_limited"),
        (401, "auth_failed"),
        (403, "auth_failed"),
        (404, "rejected"),
    ],
)
async def test_rest_maps_upstream_failures_to_one_shape(status, kind):
    provider, _ = _rest(
        lambda request: httpx.Response(
            status, json={"error": "nope"}, headers={"retry-after": "2"}
        )
    )

    response = await _invoke(provider)

    assert response.output is None and response.failure.kind == kind
    if kind == "rate_limited":
        assert response.failure.retry_after_ms == 2000


async def test_rest_withholds_an_answer_that_echoes_the_key():
    provider, _ = _rest(
        lambda request: httpx.Response(400, json={"error": f"bad key {KEY}"})
    )

    response = await _invoke(provider)

    assert response.failure.kind == "rejected"
    assert KEY not in response.failure.message


async def test_rest_refuses_a_success_that_is_not_a_json_object():
    provider, _ = _rest(lambda request: httpx.Response(200, text="<html>"))

    assert (await _invoke(provider)).failure.kind == "rejected"


async def test_rest_reports_a_refused_connection_as_not_sent():
    def refuse(request):
        raise httpx.ConnectError("refused", request=request)

    provider, requests = _rest(refuse)

    with pytest.raises(ManagedActionNotSentError):
        await _invoke(provider)
    assert len(requests) == 1


async def test_rest_dispatches_once_and_propagates_a_read_timeout_as_unknown():
    def hang_up(request):
        raise httpx.ReadTimeout("no answer", request=request)

    provider, requests = _rest(hang_up)

    with pytest.raises(httpx.ReadTimeout):
        await _invoke(provider)
    assert len(requests) == 1


def test_rest_production_transport_never_retries():
    provider = RestActionProvider(
        name="acme_rest",
        base_url="https://api.acme.example",
        credential_header="x-api-key",
        credential=KEY,
    )
    pool = provider._client._transport._pool  # pylint: disable=protected-access
    assert pool._retries == 0  # pylint: disable=protected-access


async def test_the_mock_rest_upstream_checks_the_key_and_the_fixed_flag():
    rest, _ = build_mock_providers()

    ok = await _invoke(rest, arguments={"email": "jane.doe@acme.com"})
    assert ok.output["person"]["name"] == "Jane Doe"
    assert ok.provider_reference.startswith("mock-rest-")

    miss = await _invoke(rest, arguments={"email": "nobody@acme.com"})
    assert miss.failure.kind == "rejected"

    costly = await _invoke(
        rest, arguments={"email": "jane@acme.com", "reveal_phone_number": True}
    )
    assert costly.failure.kind == "rejected"

    wrong_key = RestActionProvider(
        name="mock_rest",
        base_url="http://mock-managed-rest.invalid/v1",
        credential_header="x-api-key",
        credential="another-key-0123456789",
        transport=rest._client._transport,  # pylint: disable=protected-access
    )
    assert (await _invoke(wrong_key)).failure.kind == "auth_failed"


# --- MCP ------------------------------------------------------------------------------- #


class _Recording(MockManagedMCPUpstream):
    def __init__(self, *, on_call=None, on_initialize=None):
        self.methods = []
        self.on_call = on_call
        self.on_initialize = on_initialize

    async def relay(self, *, route, auth, context, body, headers):
        method = json.loads(body).get("method")
        self.methods.append(method)
        if method == "initialize" and self.on_initialize:
            return self.on_initialize()
        if method == "tools/call" and self.on_call:
            return self.on_call()
        return await super().relay(
            route=route, auth=auth, context=context, body=body, headers=headers
        )


def _mcp(upstream):
    return MCPActionProvider(
        name="acme_mcp",
        upstream=upstream,
        route=MCPResolvedRoute(url=MOCK_MCP_URL),
        auth=MCPDirectAuth(secret=None),
    )


async def test_mcp_handshakes_then_calls_the_tool_once_and_reads_an_event_stream():
    upstream = _Recording()

    response = await _invoke(
        _mcp(upstream),
        operation="search_companies",
        arguments={"query": "x", "limit": 3},
    )

    assert len(response.output["companies"]) == 3
    assert upstream.methods == ["initialize", "notifications/initialized", "tools/call"]


async def test_mcp_reports_a_tool_error_as_a_failure():
    upstream = _Recording(
        on_call=lambda: MCPRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "content": [{"type": "text", "text": "quota exceeded"}],
                        "isError": True,
                    },
                }
            ).encode(),
        )
    )

    response = await _invoke(_mcp(upstream), operation="search_companies")

    assert response.failure.kind == "rejected"
    assert response.failure.message == "quota exceeded"


async def test_mcp_maps_a_refused_credential_and_a_rate_limit():
    for status, kind in ((401, "auth_failed"), (429, "rate_limited")):
        upstream = _Recording(
            on_call=lambda status=status: MCPRelayResult(
                status_code=status, headers={}, body=b""
            )
        )
        response = await _invoke(_mcp(upstream), operation="search_companies")
        assert response.failure.kind == kind


async def test_mcp_a_failed_handshake_is_not_sent():
    upstream = _Recording(
        on_initialize=lambda: MCPRelayResult(status_code=500, headers={}, body=b"")
    )

    with pytest.raises(ManagedActionNotSentError):
        await _invoke(_mcp(upstream), operation="search_companies")
    assert "tools/call" not in upstream.methods


async def test_mcp_dispatches_the_tool_once_and_propagates_a_timeout_as_unknown():
    def time_out():
        try:
            raise httpx.ReadTimeout("no answer")
        except httpx.ReadTimeout as exc:
            raise MCPUpstreamError(target=MOCK_MCP_URL, detail="timeout") from exc

    upstream = _Recording(on_call=time_out)

    with pytest.raises(MCPUpstreamError):
        await _invoke(_mcp(upstream), operation="search_companies")
    assert upstream.methods.count("tools/call") == 1


async def test_mcp_a_refused_connection_on_the_call_is_not_sent():
    def refuse():
        try:
            raise httpx.ConnectError("refused")
        except httpx.ConnectError as exc:
            raise MCPUpstreamError(target=MOCK_MCP_URL, detail="refused") from exc

    upstream = _Recording(on_call=refuse)

    with pytest.raises(ManagedActionNotSentError):
        await _invoke(_mcp(upstream), operation="search_companies")


# --- review round 1: decoded credentials, the handshake's end, event streams, cookies -- #


def _escaped(value: str) -> str:
    return "".join(f"\\u{ord(ch):04x}" for ch in value)


async def test_rest_withholds_a_success_whose_decoded_output_carries_the_key():
    body = '{"person": {"name": "' + _escaped(KEY) + '"}}'
    provider, _ = _rest(
        lambda request: httpx.Response(
            200, content=body.encode(), headers={"content-type": "application/json"}
        )
    )

    response = await _invoke(provider)

    assert response.output is None
    assert response.failure.message == "the answer was withheld"


async def test_rest_carries_no_cookie_from_one_organization_to_the_next():
    provider, requests = _rest(
        lambda request: httpx.Response(
            200, json={"ok": True}, headers={"set-cookie": "session=org-a; Path=/"}
        )
    )

    await _invoke(provider)
    await _invoke(provider)

    assert "cookie" not in requests[1].headers


def _mcp_with_key(upstream, key):
    secret = ResolvedSecret(
        secret=SecretResponseDTO(
            id=uuid4(),
            kind=SecretKind.CUSTOM_SECRET,
            data=CustomSecretDTO(
                secret=CustomSecretSettingsDTO(
                    format=CustomSecretFormat.TEXT, content=key
                )
            ),
            header=Header(name="key"),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.LOCAL,
    )
    return MCPActionProvider(
        name="acme_mcp",
        upstream=upstream,
        route=MCPResolvedRoute(url=MOCK_MCP_URL),
        auth=MCPDirectAuth(secret=secret),
    )


async def test_mcp_withholds_a_decoded_answer_that_carries_the_key():
    found = {"companies": [{"name": KEY, "domain": "x.example", "employees": 1}]}
    upstream = _Recording(
        on_call=lambda: MCPRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=(
                '{"jsonrpc": "2.0", "id": 2, "result": {"structuredContent": '
                + json.dumps(found).replace(KEY, _escaped(KEY))
                + "}}"
            ).encode(),
        )
    )

    response = await _invoke(_mcp_with_key(upstream, KEY), operation="search_companies")

    assert response.failure.message == "the answer was withheld"


async def test_mcp_a_refused_end_of_handshake_never_sends_the_paid_call():
    class _Refusing(_Recording):
        async def relay(self, *, route, auth, context, body, headers):
            if json.loads(body).get("method") == "notifications/initialized":
                self.methods.append("notifications/initialized")
                return MCPRelayResult(status_code=415, headers={}, body=b"")
            return await super().relay(
                route=route, auth=auth, context=context, body=body, headers=headers
            )

    upstream = _Refusing()

    with pytest.raises(ManagedActionNotSentError):
        await _invoke(_mcp(upstream), operation="search_companies")
    assert "tools/call" not in upstream.methods


async def test_mcp_reads_an_answer_split_over_several_data_lines():
    found = {"companies": [{"name": "A", "domain": "a.example", "employees": 1}]}
    message = {"jsonrpc": "2.0", "id": 2, "result": {"structuredContent": found}}
    lines = json.dumps(message, indent=1).split("\n")
    body = "event: message\n" + "".join(f"data: {line}\n" for line in lines) + "\n"
    upstream = _Recording(
        on_call=lambda: MCPRelayResult(
            status_code=200,
            headers={"content-type": "text/event-stream"},
            body=body.encode(),
        )
    )

    response = await _invoke(_mcp(upstream), operation="search_companies")

    assert response.output == found


async def test_mcp_a_stream_that_ends_without_the_answer_is_an_unknown_outcome():
    upstream = _Recording(
        on_call=lambda: MCPRelayResult(
            status_code=200,
            headers={"content-type": "text/event-stream"},
            body=b'event: message\ndata: {"jsonrpc": "2.0", "id": 2, "res',
        )
    )

    with pytest.raises(MCPActionOutcomeUnknownError):
        await _invoke(_mcp(upstream), operation="search_companies")


# --- review round 2: the key in an error answer ---------------------------------------- #


async def test_rest_withholds_an_error_answer_whose_decoded_body_carries_the_key():
    body = '{"error": "bad key ' + _escaped(KEY) + '"}'
    provider, _ = _rest(
        lambda request: httpx.Response(
            400, content=body.encode(), headers={"content-type": "application/json"}
        )
    )

    response = await _invoke(provider)

    assert response.failure.message == "the answer was withheld"


async def test_mcp_withholds_an_error_whose_key_crosses_the_truncation_point():
    text = "x" * 290 + _escaped(KEY)
    upstream = _Recording(
        on_call=lambda: MCPRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=(
                '{"jsonrpc": "2.0", "id": 2, "result": {"isError": true, "content": '
                '[{"type": "text", "text": "' + text + '"}]}}'
            ).encode(),
        )
    )

    response = await _invoke(_mcp_with_key(upstream, KEY), operation="search_companies")

    assert response.failure.message == "the answer was withheld"


async def test_mcp_withholds_a_key_hidden_in_json_text_content():
    inner = json.dumps(
        {"companies": [{"name": _escaped(KEY), "domain": "x", "employees": 1}]}
    ).replace("\\\\u", "\\u")
    message = {
        "jsonrpc": "2.0",
        "id": 2,
        "result": {"content": [{"type": "text", "text": inner}], "isError": False},
    }
    upstream = _Recording(
        on_call=lambda: MCPRelayResult(
            status_code=200,
            headers={"content-type": "application/json"},
            body=json.dumps(message).encode(),
        )
    )

    response = await _invoke(_mcp_with_key(upstream, KEY), operation="search_companies")

    assert response.failure.message == "the answer was withheld"
