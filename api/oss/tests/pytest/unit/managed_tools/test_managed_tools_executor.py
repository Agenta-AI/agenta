"""The executor's steps and failure semantics, against fake ports."""

import asyncio

import pytest

from oss.src.core.managed_tools import service as service_module
from oss.src.core.managed_tools.dtos import (
    ManagedActionOutcome,
    ManagedActionPrice,
    ManagedActionProviderCost,
    ManagedActionRateLimit,
    ManagedActionResponse,
    ManagedActionUnit,
    ManagedActionUpstreamFailure,
)
from oss.src.core.managed_tools.mock.actions import (
    ENRICH_PERSON,
    MOCK_ACTIONS,
    MOCK_MCP_PROVIDER,
    MOCK_REST_PROVIDER,
)
from oss.src.core.managed_tools.registry import ManagedActionRegistry
from oss.src.core.managed_tools.service import ManagedToolsService
from oss.src.core.managed_tools.types import (
    ManagedActionNotFoundError,
    ManagedActionNotSentError,
)
from oss.tests.pytest.unit.managed_tools.fakes import (
    FakeBilling,
    FakeProvider,
    FakeRateLimiter,
    context,
)

PERSON = {
    "person": {
        "name": "Jane Doe",
        "title": "CTO",
        "company": "Acme",
        "linkedin_url": "https://linkedin.example/in/jane",
    }
}


def _companies(count):
    return {
        "companies": [
            {"name": f"C{i}", "domain": f"c{i}.example", "employees": 10}
            for i in range(count)
        ]
    }


def _ok(output):
    return lambda **_: ManagedActionResponse(output=output)


def _service(rest=None, mcp=None, billing=None, rate_limiter=None):
    rest = rest or FakeProvider(MOCK_REST_PROVIDER, answer=_ok(PERSON))
    mcp = mcp or FakeProvider(
        MOCK_MCP_PROVIDER,
        answer=lambda arguments, **_: ManagedActionResponse(
            output=_companies(arguments["limit"])
        ),
    )
    billing = billing or FakeBilling()
    service = ManagedToolsService(
        registry=ManagedActionRegistry(actions=MOCK_ACTIONS, providers=[rest, mcp]),
        billing=billing,
        rate_limiter=rate_limiter,
    )
    return service, rest, mcp, billing


async def test_a_per_call_action_counts_one_unit_and_records_one_measurement():
    service, rest, _, billing = _service()
    ctx = context()

    result = await service.execute(
        context=ctx, tool="mock_enrich_person", arguments={"email": "jane@acme.com"}
    )

    assert result.error is None and result.output == PERSON
    [measurement] = billing.recorded
    assert measurement.execution_id == result.execution_id
    assert result.execution_id.startswith("tool_")
    assert (measurement.action, measurement.unit, measurement.units) == (
        "mock.enrich_person",
        ManagedActionUnit.CALLS,
        1,
    )
    assert measurement.outcome == ManagedActionOutcome.SUCCEEDED
    assert measurement.provider == MOCK_REST_PROVIDER
    # The trusted context reaches both the provider and billing, with the execution id.
    assert measurement.context.organization_id == ctx.organization_id
    assert measurement.context.session_id == "session-1"
    assert rest.calls[0]["context"].execution_id == result.execution_id


async def test_a_per_result_action_counts_the_results_it_returned():
    service, _, mcp, billing = _service()

    result = await service.execute(
        context=context(),
        tool="mock_search_companies",
        arguments={"query": "robots", "limit": 7},
    )

    assert len(result.output["companies"]) == 7
    assert billing.recorded[0].units == 7
    assert billing.recorded[0].unit == ManagedActionUnit.RESULTS
    assert len(mcp.calls) == 1


async def test_fixed_arguments_are_merged_and_the_model_cannot_send_them():
    service, rest, _, billing = _service()

    refused = await service.execute(
        context=context(),
        tool="mock_enrich_person",
        arguments={"email": "jane@acme.com", "reveal_phone_number": True},
    )
    assert refused.error.code == "invalid_arguments"
    assert rest.calls == [] and billing.admitted == []

    await service.execute(
        context=context(),
        tool="mock_enrich_person",
        arguments={"email": "jane@acme.com"},
    )
    assert rest.calls[0]["arguments"] == {
        "email": "jane@acme.com",
        "reveal_phone_number": False,
    }
    assert rest.calls[0]["operation"] == "people/enrich"


async def test_an_unknown_tool_is_refused_before_anything_runs():
    service, rest, mcp, billing = _service()

    with pytest.raises(ManagedActionNotFoundError):
        await service.execute(
            context=context(), tool="COMPOSIO_RAW_OPERATION", arguments={}
        )

    assert rest.calls == [] and mcp.calls == []
    assert billing.admitted == [] and billing.recorded == []


async def test_invalid_arguments_are_refused_before_admission():
    service, rest, _, billing = _service()

    result = await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "nope"}
    )

    assert result.error.code == "invalid_arguments"
    assert result.execution_id is None
    assert billing.admitted == [] and rest.calls == [] and billing.recorded == []


async def test_a_refused_admission_never_contacts_the_upstream():
    service, rest, _, billing = _service(billing=FakeBilling(allowed=False))

    result = await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert result.error.code == "wallet_balance_exhausted"
    assert result.error.retryable is False
    assert rest.calls == [] and billing.recorded == []


@pytest.mark.parametrize(
    "billing",
    [FakeBilling(admit_raises=RuntimeError("wallet down")), FakeBilling(admit_delay=1)],
    ids=["raises", "stalls"],
)
async def test_a_wallet_that_cannot_answer_refuses(billing, monkeypatch):
    monkeypatch.setattr(service_module, "ADMISSION_TIMEOUT_SECONDS", 0.05)
    service, rest, _, _ = _service(billing=billing)

    result = await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert result.error.code == "wallet_balance_exhausted"
    assert rest.calls == []


async def test_the_rate_limit_is_per_organization_and_provider_and_runs_before_admission():
    limit = ManagedActionRateLimit(burst=1, per_minute=1)
    rest = FakeProvider(MOCK_REST_PROVIDER, answer=_ok(PERSON), rate_limit=limit)
    limiter = FakeRateLimiter(retry_after_ms=1500)
    service, _, _, billing = _service(rest=rest, rate_limiter=limiter)
    ctx = context()

    result = await service.execute(
        context=ctx, tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert result.error.code == "rate_limited"
    assert result.error.retryable is True
    assert result.error.details == {"retry_after_ms": 1500}
    assert limiter.keys == [(MOCK_REST_PROVIDER, ctx.organization_id)]
    assert billing.admitted == [] and rest.calls == []


async def test_a_failing_rate_limiter_admits():
    limit = ManagedActionRateLimit(burst=1, per_minute=1)
    rest = FakeProvider(MOCK_REST_PROVIDER, answer=_ok(PERSON), rate_limit=limit)
    service, _, _, _ = _service(
        rest=rest, rate_limiter=FakeRateLimiter(raises=RuntimeError("redis"))
    )

    result = await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert result.error is None and len(rest.calls) == 1


@pytest.mark.parametrize(
    "failure, code, retryable",
    [
        (
            ManagedActionUpstreamFailure(
                kind="rate_limited", message="slow down", retry_after_ms=2000
            ),
            "provider_rate_limited",
            True,
        ),
        (
            ManagedActionUpstreamFailure(kind="auth_failed", message="bad key"),
            "provider_auth_failed",
            False,
        ),
        (
            ManagedActionUpstreamFailure(kind="rejected", message="no match"),
            "provider_error",
            False,
        ),
    ],
)
async def test_an_upstream_failure_is_recorded_and_not_charged(
    failure, code, retryable
):
    rest = FakeProvider(
        MOCK_REST_PROVIDER,
        answer=lambda **_: ManagedActionResponse(
            failure=failure, provider_reference="req-9"
        ),
    )
    service, _, _, billing = _service(rest=rest)

    result = await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert result.error.code == code and result.error.retryable is retryable
    assert "bad key" not in result.error.message
    [measurement] = billing.recorded
    assert measurement.outcome == ManagedActionOutcome.FAILED
    assert measurement.units == 0
    assert measurement.provider_reference == "req-9"


async def test_output_that_breaks_the_contract_is_a_failure_not_a_charge():
    rest = FakeProvider(MOCK_REST_PROVIDER, answer=_ok({"unexpected": True}))
    service, _, _, billing = _service(rest=rest)

    result = await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert result.error.code == "provider_error" and result.output is None
    assert billing.recorded[0].outcome == ManagedActionOutcome.FAILED
    assert billing.recorded[0].units == 0


async def test_a_request_that_never_left_is_not_recorded():
    def refuse(**_):
        raise ManagedActionNotSentError("connection refused")

    rest = FakeProvider(MOCK_REST_PROVIDER, answer=refuse)
    service, _, _, billing = _service(rest=rest)

    result = await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert result.error.code == "provider_unavailable"
    assert result.error.retryable is True
    assert billing.recorded == []


async def test_a_timeout_is_an_unknown_outcome_recorded_once_and_never_retried(
    monkeypatch,
):
    async def hang(**_):
        await asyncio.sleep(10)

    rest = FakeProvider(MOCK_REST_PROVIDER, answer=hang)
    service, _, _, billing = _service(rest=rest)
    fast = ENRICH_PERSON.model_copy(update={"timeout_seconds": 0.05})
    monkeypatch.setattr(service.registry, "get_by_tool", lambda tool: fast)

    result = await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert result.error.code == "outcome_unknown"
    assert result.error.retryable is False
    assert len(rest.calls) == 1
    [measurement] = billing.recorded
    assert measurement.outcome == ManagedActionOutcome.UNKNOWN
    assert measurement.units == 0
    assert measurement.execution_id == result.execution_id


async def test_a_caller_that_leaves_mid_call_leaves_one_unknown_measurement():
    started = asyncio.Event()

    async def hang(**_):
        started.set()
        await asyncio.sleep(10)

    rest = FakeProvider(MOCK_REST_PROVIDER, answer=hang)
    service, _, _, billing = _service(rest=rest)

    task = asyncio.ensure_future(
        service.execute(
            context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
        )
    )
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    [measurement] = billing.recorded
    assert measurement.outcome == ManagedActionOutcome.UNKNOWN


async def test_a_caller_that_leaves_during_the_hand_off_keeps_the_known_outcome():
    billing = FakeBilling(record_delay=0.1)
    service, _, _, _ = _service(billing=billing)

    task = asyncio.ensure_future(
        service.execute(
            context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
        )
    )
    await asyncio.sleep(0.03)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0.15)

    [measurement] = billing.recorded
    assert measurement.outcome == ManagedActionOutcome.SUCCEEDED
    assert measurement.units == 1


@pytest.mark.parametrize(
    "billing",
    [FakeBilling(record_raises=RuntimeError("redis")), FakeBilling(record_delay=1)],
    ids=["raises", "stalls"],
)
async def test_a_failing_hand_off_never_changes_the_result(billing, monkeypatch):
    monkeypatch.setattr(service_module, "RECORD_TIMEOUT_SECONDS", 0.05)
    service, _, _, _ = _service(billing=billing)

    result = await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert result.error is None and result.output == PERSON


async def test_a_failing_provider_is_never_substituted_by_another():
    def refuse(**_):
        raise ManagedActionNotSentError("down")

    rest = FakeProvider(MOCK_REST_PROVIDER, answer=refuse)
    service, _, mcp, _ = _service(rest=rest)

    await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert len(rest.calls) == 1 and mcp.calls == []


async def test_provider_cost_is_carried_to_billing_as_evidence():
    cost = ManagedActionProviderCost(unit="credits", amount=1.0)
    rest = FakeProvider(
        MOCK_REST_PROVIDER,
        answer=lambda **_: ManagedActionResponse(output=PERSON, provider_cost=cost),
    )
    service, _, _, billing = _service(rest=rest)

    await service.execute(
        context=context(), tool="mock_enrich_person", arguments={"email": "a@b.co"}
    )

    assert billing.recorded[0].provider_cost == cost


async def test_the_listing_carries_prices_and_survives_without_them():
    price = ManagedActionPrice(unit=ManagedActionUnit.CALLS, musd_per_unit=20_000)
    service, _, _, _ = _service(
        billing=FakeBilling(prices={"mock.enrich_person": price})
    )

    listed = dict((action.key, found) for action, found in await service.list_actions())

    assert listed == {"mock.enrich_person": price, "mock.search_companies": None}

    class _Broken(FakeBilling):
        async def prices(self):
            raise RuntimeError("down")

    service, _, _, _ = _service(billing=_Broken())
    assert len(await service.list_actions()) == 2
