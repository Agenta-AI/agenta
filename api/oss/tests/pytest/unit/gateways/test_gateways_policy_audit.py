"""Unit tests for the gateway audit event (specs-wp4.md, D22).

`_safe_publish` swallows failures internally, so mocking
`oss.src.core.events.utils.publish_event` is the seam: it is the last thing
called before the event reaches the (mocked-out) transport.
"""

import json
from typing import AsyncIterator
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from oss.src.core.access.permissions.types import Permission
from oss.src.core.events.types import EventType
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointData,
    LLMEndpointSettings,
    LLMModelFilter,
)
from oss.src.core.gateways.llms.interfaces import (
    LLMEndpointsDAOInterface,
    LLMRelayResult,
    LLMUpstreamInterface,
)
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.policy.audit import (
    build_gateway_call_attributes,
    publish_gateway_call,
)
from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayUsage,
    GatewayPlane,
    GatewayTarget,
    PolicyDecision,
    SecretOrigin,
    SecretOwner,
    SecretOwnerKind,
)
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.utils.context import AuthScope


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def _llm_target(**overrides) -> GatewayTarget:
    defaults = dict(
        plane=GatewayPlane.LLM,
        namespace=GatewayEndpointNamespace.STANDARD,
        name="openai",
        model="gpt-4o",
    )
    defaults.update(overrides)
    return GatewayTarget(**defaults)


def _mcp_target(**overrides) -> GatewayTarget:
    defaults = dict(
        plane=GatewayPlane.MCP,
        namespace=GatewayEndpointNamespace.BUILTIN,
        name="notion",
        provider="composio",
        integration="notion",
        method="tools/call",
        tool="search",
    )
    defaults.update(overrides)
    return GatewayTarget(**defaults)


def _allowed(permission=Permission.USE_LLM_ENDPOINTS) -> PolicyDecision:
    return PolicyDecision(allowed=True, permission=permission, reason=None)


def _denied(reason: str, permission=Permission.USE_LLM_ENDPOINTS) -> PolicyDecision:
    return PolicyDecision(allowed=False, permission=permission, reason=reason)


# --- build_gateway_call_attributes ------------------------------------------ #


def test_attributes_carry_principal_target_decision_outcome():
    scope = _scope()
    target = _llm_target(endpoint_id=uuid4())
    outcome = GatewayOutcome(
        status_code=200,
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )

    attributes = build_gateway_call_attributes(
        scope=scope, target=target, decision=_allowed(), outcome=outcome
    )

    assert attributes["organization_id"] == str(scope.organization_id)
    assert attributes["workspace_id"] == str(scope.workspace_id)
    assert attributes["project_id"] == str(scope.project_id)
    assert attributes["user_id"] == str(scope.user_id)
    assert attributes["plane"] == "llm"
    assert attributes["namespace"] == "standard"
    assert attributes["name"] == "openai"
    assert attributes["endpoint_id"] == str(target.endpoint_id)
    assert attributes["model"] == "gpt-4o"
    assert attributes["allowed"] is True
    assert "reason" not in attributes
    assert attributes["status_code"] == 200
    assert attributes["secret_origin"] == "vault"


def test_attributes_carry_denial_reason():
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_llm_target(),
        decision=_denied("model_not_allowed"),
        outcome=GatewayOutcome(status_code=403),
    )

    assert attributes["allowed"] is False
    assert attributes["reason"] == "model_not_allowed"
    assert attributes["status_code"] == 403
    assert "secret_origin" not in attributes


def test_pass_through_call_leaves_secret_origin_unset():
    """No secret resolved (pass-through) — `secret_origin` distinguishes a call
    we funded from one the caller did (specs-wp4.md)."""
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_llm_target(),
        decision=_allowed(),
        outcome=GatewayOutcome(status_code=200, owner=None, origin=None),
    )

    assert "secret_origin" not in attributes


def test_attributes_carry_no_request_or_response_body_value():
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_mcp_target(),
        decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
        outcome=GatewayOutcome(status_code=200, origin=SecretOrigin.LOCAL),
    )

    forbidden = {
        "prompt",
        "completion",
        "body",
        "headers",
        "secret",
        "x-ag-credentials",
    }
    assert forbidden.isdisjoint({key.lower() for key in attributes})
    for value in attributes.values():
        assert "X-AG-Credentials" not in str(value)


def test_attributes_carry_the_usage_the_call_reported():
    """OR49: the audit event is the only consumer of `outcome.usage`, and it used to read
    none of it, so every token count the relay collected was thrown away here."""
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_llm_target(),
        decision=_allowed(),
        outcome=GatewayOutcome(
            status_code=200,
            usage=GatewayUsage(calls=1, input_tokens=11, output_tokens=7, cost=0.25),
        ),
    )

    assert attributes["calls"] == 1
    assert attributes["input_tokens"] == 11
    assert attributes["output_tokens"] == 7
    assert attributes["cost"] == 0.25


def test_a_call_that_reported_no_usage_carries_no_token_counts():
    """An unmetered call must not read as a call that cost nothing."""
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_llm_target(),
        decision=_allowed(),
        outcome=GatewayOutcome(status_code=200, usage=None),
    )

    assert "calls" not in attributes
    assert "input_tokens" not in attributes
    assert "output_tokens" not in attributes


# --- what was called, how long it took, and which run made it ---------------- #


def test_attributes_carry_the_method_and_tool_an_mcp_call_named():
    """`GatewayTarget` carried both from the relay's first day and the event read
    neither, so an MCP audit record said an endpoint had been called and nothing about
    what was called on it."""
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_mcp_target(method="tools/call", tool="search"),
        decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
        outcome=GatewayOutcome(status_code=200),
    )

    assert attributes["method"] == "tools/call"
    assert attributes["tool"] == "search"


def test_a_method_that_names_no_tool_carries_no_tool_attribute():
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_mcp_target(method="tools/list", tool=None),
        decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
        outcome=GatewayOutcome(status_code=200),
    )

    assert attributes["method"] == "tools/list"
    assert "tool" not in attributes


def test_an_llm_call_carries_neither_method_nor_tool():
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_llm_target(),
        decision=_allowed(),
        outcome=GatewayOutcome(status_code=200),
    )

    assert "method" not in attributes
    assert "tool" not in attributes


def test_a_caller_cannot_make_one_relay_into_an_unbounded_event():
    """`method` and `tool` are read off the caller's own JSON-RPC body, and the event
    goes onto a shared stream, so their length cannot be the caller's to choose."""
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_mcp_target(method="m" * 5_000, tool="t" * 5_000),
        decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
        outcome=GatewayOutcome(status_code=200),
        run_id="r" * 5_000,
    )

    assert len(attributes["method"]) == 200
    assert len(attributes["tool"]) == 200
    assert len(attributes["run_id"]) == 200


def test_attributes_carry_the_duration_the_call_took():
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_mcp_target(),
        decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
        outcome=GatewayOutcome(status_code=200, duration_ms=42),
    )

    assert attributes["duration_ms"] == 42


def test_a_call_that_reported_no_duration_carries_none():
    """An unmeasured call must not read as an instant one."""
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_mcp_target(),
        decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
        outcome=GatewayOutcome(status_code=200),
    )

    assert "duration_ms" not in attributes


def test_attributes_carry_the_run_the_call_belongs_to():
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_mcp_target(),
        decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
        outcome=GatewayOutcome(status_code=200),
        run_id="9d3f4a1c2b5e4f7a",
    )

    assert attributes["run_id"] == "9d3f4a1c2b5e4f7a"


def test_a_caller_that_belongs_to_no_run_carries_no_run_id():
    """A browser or an API-key caller holds no run-bound gateway credential, so there is
    no run to name and none is invented."""
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_mcp_target(),
        decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
        outcome=GatewayOutcome(status_code=200),
        run_id=None,
    )

    assert "run_id" not in attributes


@pytest.mark.asyncio
async def test_record_passes_the_run_through_to_the_event(monkeypatch):
    publish = AsyncMock()
    monkeypatch.setattr("oss.src.core.events.utils.publish_event", publish)

    service = GatewayPolicyService(resolver=AsyncMock())
    await service.record(
        scope=_scope(),
        target=_mcp_target(),
        decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
        outcome=GatewayOutcome(status_code=200, duration_ms=17),
        run_id="run-abc",
    )

    event = publish.await_args.kwargs["event"]
    assert event.attributes["run_id"] == "run-abc"
    assert event.attributes["duration_ms"] == 17
    assert event.attributes["method"] == "tools/call"
    assert event.attributes["tool"] == "search"


# --- publish_gateway_call ---------------------------------------------------- #


@pytest.mark.asyncio
async def test_publish_gateway_call_emits_one_event_llm_plane():
    publish = AsyncMock()
    with patch("oss.src.core.events.utils.publish_event", new=publish):
        await publish_gateway_call(
            scope=_scope(),
            target=_llm_target(),
            decision=_allowed(),
            outcome=GatewayOutcome(status_code=200, origin=SecretOrigin.VAULT),
        )

    publish.assert_awaited_once()
    event = publish.await_args.kwargs["event"]
    assert event.event_type == EventType.GATEWAYS_CALLED
    assert event.attributes["plane"] == "llm"
    assert event.attributes["allowed"] is True


@pytest.mark.asyncio
async def test_publish_gateway_call_emits_one_event_mcp_plane():
    publish = AsyncMock()
    with patch("oss.src.core.events.utils.publish_event", new=publish):
        await publish_gateway_call(
            scope=_scope(),
            target=_mcp_target(),
            decision=_allowed(permission=Permission.USE_MCP_ENDPOINTS),
            outcome=GatewayOutcome(status_code=200, origin=SecretOrigin.LOCAL),
        )

    publish.assert_awaited_once()
    event = publish.await_args.kwargs["event"]
    assert event.event_type == EventType.GATEWAYS_CALLED
    assert event.attributes["plane"] == "mcp"


@pytest.mark.asyncio
async def test_publish_gateway_call_records_denial_exactly_once():
    publish = AsyncMock()
    with patch("oss.src.core.events.utils.publish_event", new=publish):
        await publish_gateway_call(
            scope=_scope(),
            target=_llm_target(),
            decision=_denied("model_not_allowed"),
            outcome=GatewayOutcome(status_code=403),
        )

    publish.assert_awaited_once()
    event = publish.await_args.kwargs["event"]
    assert event.attributes["allowed"] is False
    assert event.attributes["reason"] == "model_not_allowed"


@pytest.mark.asyncio
async def test_publish_gateway_call_swallows_publisher_failure():
    async def _raise(**_kwargs):
        raise RuntimeError("redis down")

    with patch("oss.src.core.events.utils.publish_event", new=_raise):
        # Must not raise.
        await publish_gateway_call(
            scope=_scope(),
            target=_llm_target(),
            decision=_allowed(),
            outcome=GatewayOutcome(status_code=200),
        )


# --- through the service, on the deny path ----------------------------------- #


@pytest.mark.asyncio
async def test_record_denied_call_publishes_and_deny_still_raisable(monkeypatch):
    """`record()` itself never raises `PolicyDeniedError` — the relay raises it
    after calling `record()`. This asserts the audit half: the relay's own
    exception behaviour is exercised at the relay call sites, not here."""
    publish = AsyncMock()
    monkeypatch.setattr("oss.src.core.events.utils.publish_event", publish)

    service = GatewayPolicyService(resolver=AsyncMock())
    result = await service.record(
        scope=_scope(),
        target=_llm_target(),
        decision=_denied("permission_denied"),
        outcome=GatewayOutcome(status_code=403),
    )

    assert result is None
    publish.assert_awaited_once()
    event = publish.await_args.kwargs["event"]
    assert event.attributes["reason"] == "permission_denied"


@pytest.mark.asyncio
async def test_record_does_not_raise_when_publisher_raises(monkeypatch):
    async def _raise(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("oss.src.core.events.utils.publish_event", _raise)

    service = GatewayPolicyService(resolver=AsyncMock())
    result = await service.record(
        scope=_scope(),
        target=_llm_target(),
        decision=_allowed(),
        outcome=GatewayOutcome(status_code=200),
    )

    assert result is None


# --- through a real relay: publisher failure must not touch the result ------ #


class _PassthroughDAO(LLMEndpointsDAOInterface):
    def __init__(self, row: LLMEndpoint):
        self._row = row

    async def create_endpoint(self, *, project_id, user_id, endpoint):
        raise NotImplementedError

    async def fetch_endpoint(self, *, project_id, endpoint_id):
        raise NotImplementedError

    async def fetch_endpoint_by_slug(self, *, project_id, slug):
        return self._row if slug == self._row.slug else None

    async def edit_endpoint(self, *, project_id, user_id, endpoint):
        raise NotImplementedError

    async def delete_endpoint(self, *, project_id, endpoint_id):
        raise NotImplementedError

    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None):
        return []


class _PassthroughAdapter(LLMUpstreamInterface):
    def __init__(self, result: LLMRelayResult):
        self._result = result

    async def relay_chat_completion(self, *, route, secret, context, body, headers):
        return self._result


async def _one_chunk(data: bytes) -> AsyncIterator[bytes]:
    yield data


@pytest.mark.asyncio
async def test_relay_result_unaffected_when_publisher_raises(monkeypatch):
    """A publisher that raises does not propagate — the relay's own result is
    unaffected, not merely "no exception escaped" (specs-wp4.md)."""

    async def _raise(**_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr("oss.src.core.events.utils.publish_event", _raise)
    monkeypatch.setattr(
        "oss.src.core.gateways.policy.service.check_action_access",
        AsyncMock(return_value=True),
    )

    row = LLMEndpoint(
        id=uuid4(),
        slug="acme",
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.CUSTOM,
        namespace=GatewayEndpointNamespace.CUSTOM,
        secret_id=None,  # no secret bound: pass-through, nothing to resolve
        data=LLMEndpointData(
            models=LLMModelFilter(allowlist=["gpt-4o"]),
            settings=LLMEndpointSettings(),
        ),
    )
    adapter_result = LLMRelayResult(
        status_code=200,
        headers={},
        body=_one_chunk(b'{"ok": true}'),
    )
    service = LLMGatewayService(
        llm_endpoints_dao=_PassthroughDAO(row),
        policy=GatewayPolicyService(resolver=AsyncMock()),
        resolver=AsyncMock(),
        upstream_registry=LLMUpstreamRegistry(
            adapters={"relay": _PassthroughAdapter(adapter_result)}
        ),
    )

    result = await service.relay_chat_completion(
        scope=_scope(),
        namespace=GatewayEndpointNamespace.CUSTOM,
        name="acme",
        body=json.dumps({"model": "gpt-4o", "messages": []}).encode(),
        headers={},
    )

    assert result is adapter_result
    assert result.status_code == 200
    # Draining the body is where record() (and the raising publisher) fires.
    assert [chunk async for chunk in result.body] == [b'{"ok": true}']
