"""The gateway half of the wallet seam: spend admission before dispatch, and the usage
hand-off after it.

These compose the real `GatewayPolicyService` and `LLMGatewayService` over the in-process
mock upstream, with only the permission check, the audit publisher and the two ports
stubbed. The ports are the gateway's own; what implements them is the wallet's business
and is tested on the EE side.
"""

import ast
import asyncio
import json
import time
from pathlib import Path
from typing import List, Optional

import pytest

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMModelFilter
from oss.src.core.gateways.llms.providers.mock.adapter import MockLLMAdapter
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.policy import service as policy_service_module
from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayPlane,
    GatewayTarget,
    GatewayUsage,
    PolicyDecision,
    SecretOrigin,
    SpendAdmission,
)
from oss.src.core.gateways.policy.interfaces import (
    SpendAdmissionInterface,
    UsageSinkInterface,
)
from oss.src.core.gateways.policy.null import NullSpendAdmission, NullUsageSink
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.gateways.policy.types import (
    EntitlementDeniedError,
    PolicyDeniedError,
)
from oss.src.utils.env import env

from oss.tests.pytest.unit.gateways.test_gateways_llm_service import (
    _MockLlmEndpointsDAO,
    _MockResolver,
    _custom_row,
    _scope,
    _secret,
)

ROUTERS_PATH = Path(__file__).resolve().parents[5] / "entrypoints" / "routers.py"
GATEWAYS_SOURCE = (
    Path(__file__).resolve().parents[5] / "oss" / "src" / "core" / "gateways"
)


class _Admission(SpendAdmissionInterface):
    def __init__(self, *, allowed: bool = True, raises: bool = False):
        self.allowed = allowed
        self.raises = raises
        self.calls: List[GatewayTarget] = []

    async def admit(self, *, scope, target) -> SpendAdmission:
        self.calls.append(target)
        if self.raises:
            raise RuntimeError("wallet unavailable")
        return SpendAdmission(
            allowed=self.allowed,
            reason=None if self.allowed else "entitlement_denied",
        )


class _Sink(UsageSinkInterface):
    def __init__(self, *, raises: bool = False, stalls: bool = False):
        self.raises = raises
        self.stalls = stalls
        self.calls: List[dict] = []

    async def record(self, *, scope, target, outcome, run_id) -> None:
        self.calls.append(
            {"scope": scope, "target": target, "outcome": outcome, "run_id": run_id}
        )
        if self.raises:
            raise RuntimeError("redis down")
        if self.stalls:
            await asyncio.sleep(60)


class _CountingMockAdapter(MockLLMAdapter):
    def __init__(self) -> None:
        self.calls = 0

    async def relay_chat_completion(self, **kwargs):
        self.calls += 1
        return await super().relay_chat_completion(**kwargs)


@pytest.fixture
def audit_events(monkeypatch) -> List[dict]:
    events: List[dict] = []

    async def _publish(**kwargs):
        events.append(kwargs)

    monkeypatch.setattr(policy_service_module, "publish_gateway_call", _publish)
    return events


@pytest.fixture
def permitted(monkeypatch):
    async def _allowed(**_kwargs):
        return True

    monkeypatch.setattr(policy_service_module, "check_action_access", _allowed)


@pytest.fixture
def mocks_on(monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", True)


def _gateway(
    *,
    admission: Optional[SpendAdmissionInterface] = None,
    sink: Optional[UsageSinkInterface] = None,
):
    adapter = _CountingMockAdapter()
    resolver = _MockResolver(secret=_secret())
    service = LLMGatewayService(
        llm_endpoints_dao=_MockLlmEndpointsDAO(),
        policy=GatewayPolicyService(
            resolver=resolver, spend_admission=admission, usage_sink=sink
        ),
        resolver=resolver,
        upstream_registry=LLMUpstreamRegistry(adapters={"mock": adapter}),
    )
    return service, adapter, resolver


async def _relay(
    service: LLMGatewayService,
    *,
    namespace=GatewayEndpointNamespace.BUILTIN,
    stream: bool = False,
    run_id: Optional[str] = None,
):
    result = await service.relay_chat_completion(
        scope=_scope(),
        namespace=namespace,
        name="mock",
        body=json.dumps(
            {
                "model": "gpt-5.5",
                "messages": [{"role": "user", "content": "one two three"}],
                "stream": stream,
            }
        ).encode(),
        headers={},
        run_id=run_id,
    )
    return result, b"".join([chunk async for chunk in result.body])


# --- admission -------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_refused_builtin_call_is_never_dispatched_and_records_one_refusal(
    mocks_on, permitted, audit_events
):
    admission = _Admission(allowed=False)
    sink = _Sink()
    service, adapter, resolver = _gateway(admission=admission, sink=sink)

    with pytest.raises(EntitlementDeniedError) as refused:
        await _relay(service, run_id="run-1")

    assert refused.value.key == "wallet_balance"
    assert refused.value.target == "builtin/mock"
    assert len(admission.calls) == 1
    assert adapter.calls == 0
    assert resolver.resolve_calls == []
    [event] = audit_events
    assert event["decision"] == PolicyDecision(
        allowed=False,
        permission=Permission.USE_LLM_ENDPOINTS,
        reason="entitlement_denied",
    )
    assert event["outcome"].status_code == 403
    assert event["run_id"] == "run-1"
    assert sink.calls == []


@pytest.mark.asyncio
async def test_a_wallet_that_cannot_answer_refuses_the_builtin_call(
    mocks_on, permitted, audit_events
):
    service, adapter, _ = _gateway(admission=_Admission(raises=True), sink=_Sink())

    with pytest.raises(EntitlementDeniedError):
        await _relay(service)

    assert adapter.calls == 0
    assert audit_events[0]["decision"].reason == "entitlement_denied"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "namespace", [GatewayEndpointNamespace.STANDARD, GatewayEndpointNamespace.CUSTOM]
)
async def test_a_call_on_the_customers_own_credential_never_consults_the_wallet(
    mocks_on, permitted, audit_events, namespace
):
    """A wallet that would refuse, and is never asked."""
    admission = _Admission(allowed=False)
    sink = _Sink()
    service, adapter, _ = _gateway(admission=admission, sink=sink)
    service.llm_endpoints_dao.rows_by_slug["mock"] = _custom_row(
        slug="mock",
        deployment_kind=LLMDeploymentKind.MOCK,
        models=LLMModelFilter(allowlist=["gpt-5.5"]),
    )

    result, _ = await _relay(service, namespace=namespace)

    assert result.status_code == 200
    assert admission.calls == []
    assert adapter.calls == 1
    assert sink.calls == []


@pytest.mark.asyncio
async def test_permission_denial_wins_and_the_wallet_is_never_asked(
    mocks_on, monkeypatch, audit_events
):
    async def _denied(**_kwargs):
        return False

    monkeypatch.setattr(policy_service_module, "check_action_access", _denied)
    admission = _Admission(allowed=False)
    service, adapter, _ = _gateway(admission=admission)

    with pytest.raises(PolicyDeniedError):
        await _relay(service)

    assert admission.calls == []
    assert adapter.calls == 0
    [event] = audit_events
    assert event["decision"].reason == "permission_denied"


# --- the usage hand-off ----------------------------------------------------- #


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True], ids=["non-streaming", "streaming"])
async def test_an_admitted_builtin_call_hands_its_usage_to_the_sink_once(
    mocks_on, permitted, audit_events, stream
):
    admission = _Admission(allowed=True)
    sink = _Sink()
    service, adapter, _ = _gateway(admission=admission, sink=sink)

    result, body = await _relay(service, stream=stream, run_id="run-7")

    assert result.status_code == 200 and body
    assert len(admission.calls) == 1
    [call] = sink.calls
    assert call["run_id"] == "run-7"
    assert call["target"].plane == GatewayPlane.LLM
    assert call["target"].namespace == GatewayEndpointNamespace.BUILTIN
    assert call["target"].provider == "mock"
    assert call["target"].model == "gpt-5.5"
    assert call["outcome"].origin == SecretOrigin.LOCAL
    assert call["outcome"].usage.input_tokens > 0
    assert call["outcome"].usage.output_tokens > 0
    assert audit_events[0]["outcome"].origin == SecretOrigin.LOCAL


@pytest.mark.asyncio
async def test_a_standard_call_keeps_the_vault_origin_and_is_not_handed_off(
    mocks_on, permitted, audit_events
):
    sink = _Sink()
    service, _, _ = _gateway(sink=sink)

    await _relay(service, namespace=GatewayEndpointNamespace.STANDARD)

    assert audit_events[0]["outcome"].origin == SecretOrigin.VAULT
    assert sink.calls == []


@pytest.mark.asyncio
async def test_a_stream_the_client_abandons_before_its_end_hands_off_nothing(
    mocks_on, permitted, audit_events
):
    """The accepted loss: the mock, like every adapter, learns its usage when its body is
    exhausted. A client that disconnects first leaves no usage, so the call is audited
    and not measured, and it is free. A real `builtin` provider needs this closed before
    it launches (`v2/wave-2-status.md`, launch blockers)."""
    sink = _Sink()
    service, adapter, _ = _gateway(admission=_Admission(), sink=sink)
    result = await service.relay_chat_completion(
        scope=_scope(),
        namespace=GatewayEndpointNamespace.BUILTIN,
        name="mock",
        body=json.dumps({"model": "gpt-5.5", "messages": [], "stream": True}).encode(),
        headers={},
    )

    await anext(result.body)
    await result.body.aclose()

    assert adapter.calls == 1
    [event] = audit_events
    assert event["outcome"].usage is None
    assert sink.calls == []


@pytest.mark.asyncio
async def test_a_raising_sink_changes_nothing_about_the_relay(
    mocks_on, permitted, audit_events
):
    service, _, _ = _gateway(sink=_Sink(raises=True))

    result, body = await _relay(service)

    assert result.status_code == 200
    assert json.loads(body)["choices"]


@pytest.mark.asyncio
async def test_a_stalled_sink_holds_a_response_no_longer_than_its_bound(
    mocks_on, permitted, audit_events, monkeypatch
):
    monkeypatch.setattr(policy_service_module, "USAGE_SINK_TIMEOUT_SECONDS", 0.05)
    sink = _Sink(stalls=True)
    service, _, _ = _gateway(sink=sink)

    started = time.monotonic()
    result, _ = await _relay(service)
    elapsed = time.monotonic() - started

    assert result.status_code == 200
    assert len(sink.calls) == 1
    assert elapsed < 1.0


def test_the_production_bound_on_a_usage_hand_off_is_sub_second():
    assert 0 < policy_service_module.USAGE_SINK_TIMEOUT_SECONDS <= 0.5


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "target, decision_allowed, usage",
    [
        (
            GatewayTarget(
                plane=GatewayPlane.LLM,
                namespace=GatewayEndpointNamespace.BUILTIN,
                name="mock",
            ),
            False,
            GatewayUsage(input_tokens=1),
        ),
        (
            GatewayTarget(
                plane=GatewayPlane.MCP,
                namespace=GatewayEndpointNamespace.BUILTIN,
                name="agenta",
            ),
            True,
            GatewayUsage(),
        ),
        (
            GatewayTarget(
                plane=GatewayPlane.LLM,
                namespace=GatewayEndpointNamespace.BUILTIN,
                name="mock",
            ),
            True,
            None,
        ),
    ],
    ids=["denied", "mcp", "no-usage"],
)
async def test_the_sink_sees_only_dispatched_builtin_llm_usage(
    audit_events, target, decision_allowed, usage
):
    sink = _Sink()
    policy = GatewayPolicyService(resolver=_MockResolver(), usage_sink=sink)

    await policy.record(
        scope=_scope(),
        target=target,
        decision=PolicyDecision(
            allowed=decision_allowed, permission=Permission.USE_LLM_ENDPOINTS
        ),
        outcome=GatewayOutcome(status_code=200, usage=usage),
    )

    assert sink.calls == []
    assert len(audit_events) == 1


# --- the defaults ----------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_defaults_admit_everything_and_record_nothing(
    mocks_on, permitted, audit_events
):
    """What OSS and a wallet-off EE deployment run: the relay behaves as before."""
    policy = GatewayPolicyService(resolver=_MockResolver())
    assert isinstance(policy.spend_admission, NullSpendAdmission)
    assert isinstance(policy.usage_sink, NullUsageSink)

    service, adapter, _ = _gateway()
    result, body = await _relay(service)

    assert result.status_code == 200 and json.loads(body)["choices"]
    assert adapter.calls == 1
    assert len(audit_events) == 1


def test_the_wallet_ports_are_bound_only_behind_the_wallet_flag():
    """`routers.py` builds the wallet's adapters inside one `if` that reads
    `env.wallets.enabled`, and hands the policy service nothing otherwise. Read as source:
    importing the module builds every DAO, engine and router in the process."""
    tree = ast.parse(ROUTERS_PATH.read_text(encoding="utf-8"))
    guarded = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and "env.wallets.enabled" in ast.unparse(node.test):
            for inner in ast.walk(node):
                if isinstance(inner, ast.Call):
                    guarded.add(ast.unparse(inner.func))
    constructed = {
        ast.unparse(node.func)
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and ast.unparse(node.func) in {"WalletSpendAdmission", "MeasurementUsageSink"}
    }

    assert constructed == {"WalletSpendAdmission", "MeasurementUsageSink"}
    assert constructed <= guarded


def test_no_gateway_module_imports_enterprise_code():
    """The seam exists because OSS cannot import `ee`; the ports are declared here and
    implemented there."""
    offenders = []
    for path in GATEWAYS_SOURCE.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            modules = []
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                modules = [node.module]
            if any(module == "ee" or module.startswith("ee.") for module in modules):
                offenders.append(str(path))

    assert offenders == []
