"""The agent-facing entry: the `builtin/managed` MCP server in the gateway relay."""

import json
from uuid import uuid4

import pytest
from starlette.requests import Request

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.mcps.dtos import MCPCallContext
from oss.src.core.gateways.mcps.providers.managed.adapter import ManagedMCPAdapter
from oss.src.core.gateways.mcps.types import MCPEndpointNotFoundError
from oss.src.core.gateways.policy.types import PolicyDeniedError
from oss.src.core.managed_tools.dtos import ManagedActionPrice, ManagedActionUnit
from oss.src.core.managed_tools.mock.actions import MOCK_ACTIONS
from oss.src.core.managed_tools.mock.providers import build_mock_providers
from oss.src.core.managed_tools.registry import ManagedActionRegistry
from oss.src.core.managed_tools.service import ManagedToolsService
from oss.src.utils.context import AuthScope
from oss.tests.pytest.unit.gateways.test_gateways_mcp_service import (
    MockPolicyService,
    MockResolver,
    _relay_service,
)
from oss.tests.pytest.unit.managed_tools.fakes import FakeBilling

PRICES = {
    "mock.enrich_person": ManagedActionPrice(
        unit=ManagedActionUnit.CALLS, musd_per_unit=20_000
    ),
    "mock.search_companies": ManagedActionPrice(
        unit=ManagedActionUnit.RESULTS, musd_per_unit=2_000, max_units_per_call=10
    ),
}


def _adapter(billing=None):
    billing = billing or FakeBilling(prices=PRICES)
    service = ManagedToolsService(
        registry=ManagedActionRegistry(
            actions=MOCK_ACTIONS, providers=build_mock_providers()
        ),
        billing=billing,
    )
    return ManagedMCPAdapter(managed_tools=service), billing


def _scope():
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def _request(labels=None):
    state = {"gateway_run_id": "run-7"}
    if labels:
        state["gateway_run_labels"] = labels
    return Request({"type": "http", "method": "POST", "headers": [], "state": state})


def _rpc(method, params=None, request_id=1):
    return json.dumps(
        {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
    ).encode()


async def _relay(service, method, params=None, request=None, scope=None):
    result = await service.relay(
        scope=scope or _scope(),
        namespace=GatewayEndpointNamespace.BUILTIN,
        provider="managed",
        name="managed",
        context=MCPCallContext(method=method, target=(params or {}).get("name")),
        body=_rpc(method, params),
        headers={},
        request=request or _request(),
    )
    return json.loads(result.body)


async def test_the_server_is_listed_and_resolved_only_when_wired():
    unwired = _relay_service(adapters={})
    endpoints = await unwired.list_endpoints(scope=_scope())
    assert "managed" not in {endpoint.provider_key for endpoint in endpoints}
    with pytest.raises(MCPEndpointNotFoundError):
        await _relay(unwired, "tools/list")

    wired = _relay_service(adapters={})
    wired.managed_tools, _ = _adapter()
    endpoints = await wired.list_endpoints(scope=_scope())
    [managed] = [e for e in endpoints if e.provider_key == "managed"]
    assert managed.slug == "managed" and managed.namespace.value == "builtin"


async def test_tools_list_advertises_schemas_hints_and_prices():
    service = _relay_service(adapters={})
    service.managed_tools, _ = _adapter()

    answer = await _relay(service, "tools/list")

    tools = {tool["name"]: tool for tool in answer["result"]["tools"]}
    assert set(tools) == {"mock_enrich_person", "mock_search_companies"}
    search = tools["mock_search_companies"]
    assert search["inputSchema"]["properties"]["limit"]["maximum"] == 25
    assert "companies" in search["outputSchema"]["properties"]
    assert search["annotations"] == {"readOnlyHint": True}
    assert "$0.002 per result" in search["description"]
    assert "at most 10" in search["description"]
    assert search["_meta"]["agenta/price"]["max_units_per_call"] == 10
    assert "$0.02 per call" in tools["mock_enrich_person"]["description"]
    assert "reveal_phone_number" not in json.dumps(tools)


async def test_tools_call_runs_the_action_with_the_credentials_context():
    service = _relay_service(adapters={})
    service.managed_tools, billing = _adapter()
    scope = _scope()
    agent_id = str(uuid4())

    answer = await _relay(
        service,
        "tools/call",
        {"name": "mock_search_companies", "arguments": {"query": "x", "limit": 4}},
        request=_request({"session_id": "s-1", "agent_id": agent_id}),
        scope=scope,
    )

    result = answer["result"]
    assert result["isError"] is False
    assert len(result["structuredContent"]["companies"]) == 4
    [measurement] = billing.recorded
    assert measurement.units == 4
    assert measurement.context.organization_id == scope.organization_id
    assert measurement.context.project_id == scope.project_id
    assert (measurement.context.run_id, measurement.context.session_id) == (
        "run-7",
        "s-1",
    )
    assert measurement.context.agent_id == agent_id


async def test_identity_in_the_arguments_is_refused_not_used():
    service = _relay_service(adapters={})
    service.managed_tools, billing = _adapter()

    answer = await _relay(
        service,
        "tools/call",
        {
            "name": "mock_enrich_person",
            "arguments": {"email": "a@b.co", "organization_id": str(uuid4())},
        },
    )

    assert answer["result"]["isError"] is True
    assert answer["result"]["structuredContent"]["error"]["code"] == "invalid_arguments"
    assert billing.admitted == []


async def test_a_refusal_is_a_tool_error_in_the_shared_envelope():
    service = _relay_service(adapters={})
    service.managed_tools, _ = _adapter(FakeBilling(allowed=False, prices=PRICES))

    answer = await _relay(
        service,
        "tools/call",
        {"name": "mock_enrich_person", "arguments": {"email": "a@b.co"}},
    )

    error = answer["result"]["structuredContent"]["error"]
    assert answer["result"]["isError"] is True
    assert error["code"] == "wallet_balance_exhausted"
    assert set(error) <= {"code", "message", "retryable", "next_step", "details"}


async def test_an_unknown_tool_is_a_protocol_error():
    service = _relay_service(adapters={})
    service.managed_tools, billing = _adapter()

    answer = await _relay(service, "tools/call", {"name": "raw_upstream_op"})

    assert answer["error"]["code"] == -32602
    assert billing.admitted == []


async def test_permission_denial_never_reaches_the_executor():
    service = _relay_service(
        adapters={}, policy=MockPolicyService(allow=False), resolver=MockResolver()
    )
    service.managed_tools, billing = _adapter()

    with pytest.raises(PolicyDeniedError):
        await _relay(
            service,
            "tools/call",
            {"name": "mock_enrich_person", "arguments": {"email": "a@b.co"}},
        )
    assert billing.admitted == [] and billing.recorded == []


async def test_the_handshake_and_notifications_are_free():
    service = _relay_service(adapters={})
    service.managed_tools, billing = _adapter()

    answer = await _relay(service, "initialize", {"protocolVersion": "2025-03-26"})
    assert answer["result"]["protocolVersion"] == "2025-03-26"
    assert billing.admitted == [] and billing.recorded == []
