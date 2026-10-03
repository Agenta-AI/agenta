"""The runner's sandbox routes: what each outcome answers, so the runner knows whether to
keep, drop, or retry an interval."""

import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from starlette.requests import Request

from oss.src.utils.context import (
    AuthContext,
    AuthScope,
    SecretCredentials,
    reset_auth_context,
    set_auth_context,
)

from oss.src.apis.fastapi.shared import runner_auth

from ee.src.apis.fastapi.wallets.router import WalletsRouter
from ee.src.core.measurements.sandboxes import (
    SandboxUsageInterval,
    SandboxUsageService,
)
from ee.src.apis.fastapi.wallets.models import (
    SandboxAdmissionRequest,
    SandboxTurnRequest,
)
from ee.src.core.access.entitlements.types import (
    BUSINESS_AGENT_TURN_CAPS,
    HOBBY_AGENT_TURN_CAPS,
    PRO_AGENT_TURN_CAPS,
)
from ee.tests.pytest.utils.measurements.fakes import (
    InMemoryMeasurementPublisher,
    InMemorySessionTurnHolds,
    InMemoryTurnSlots,
)

pytestmark = pytest.mark.asyncio

START = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)


class _Wallet:
    def __init__(self, allowed=True):
        self.allowed = allowed

    async def check(self, *, organization_id):
        return self.allowed


@contextmanager
def _caller():
    scope = AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )
    token = set_auth_context(
        AuthContext(credentials=SecretCredentials(value="run-token"), scope=scope)
    )
    try:
        yield scope
    finally:
        reset_auth_context(token)


def _router(*, allowed=True, publisher=None, slots=None, plan=None):
    async def plan_for(organization_id):
        return plan

    return WalletsRouter(
        wallet_usage_service=None,
        sandbox_usage_service=SandboxUsageService(
            wallet=_Wallet(allowed),
            publisher=publisher or InMemoryMeasurementPublisher(),
            turn_slots=slots if slots is not None else InMemoryTurnSlots(),
            session_holds=InMemorySessionTurnHolds(),
            plan_for=plan_for,
        ),
    )


def _request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": []})


def _interval(**overrides):
    values = dict(
        provider="daytona",
        sandbox_id="sb-1",
        start_time=START,
        end_time=START + timedelta(seconds=60),
        vcpu=2,
        memory_gib=4,
    )
    values.update(overrides)
    return SandboxUsageInterval(**values)


@pytest.mark.parametrize("allowed", [True, False])
async def test_admission_answers_the_wallet_check(allowed):
    with _caller():
        response = await _router(allowed=allowed).admit_sandbox(_request())

    assert response.allowed is allowed


HOBBY = "cloud_v0_hobby"
PRO = "cloud_v0_pro"
BUSINESS = "cloud_v0_business"


def _turn(turn_id):
    return SandboxAdmissionRequest(turn_id=turn_id)


@pytest.mark.parametrize(
    "plan,caps",
    [
        (HOBBY, HOBBY_AGENT_TURN_CAPS),
        (PRO, PRO_AGENT_TURN_CAPS),
        (BUSINESS, BUSINESS_AGENT_TURN_CAPS),
    ],
)
async def test_each_plan_runs_its_number_of_turns_at_once_and_refuses_the_next(
    plan, caps
):
    router = _router(plan=plan)
    with _caller():
        for i in range(caps.concurrent_turns):
            admitted = await router.admit_sandbox(_request(), _turn(f"t-{i}"))
            assert admitted.allowed is True and admitted.slot_held is True
            assert admitted.turn_limit.seconds == caps.max_turn_seconds
        refused = await router.admit_sandbox(_request(), _turn("one-too-many"))

    assert refused.allowed is False
    assert refused.code == "concurrent_turns_limit"
    assert f"can run {caps.concurrent_turns} agents at the same time" in refused.message
    assert refused.turn_limit is None and refused.slot_held is False


def test_the_decided_caps():
    assert (
        HOBBY_AGENT_TURN_CAPS.concurrent_turns,
        HOBBY_AGENT_TURN_CAPS.max_turn_seconds,
    ) == (2, 1800)
    assert (
        PRO_AGENT_TURN_CAPS.concurrent_turns,
        PRO_AGENT_TURN_CAPS.max_turn_seconds,
    ) == (10, 14400)
    assert (
        BUSINESS_AGENT_TURN_CAPS.concurrent_turns,
        BUSINESS_AGENT_TURN_CAPS.max_turn_seconds,
    ) == (25, 39600)


async def test_a_released_turn_frees_its_slot_and_a_retried_turn_keeps_its_own():
    router = _router(plan=HOBBY)
    with _caller():
        assert (await router.admit_sandbox(_request(), _turn("a"))).allowed
        assert (await router.admit_sandbox(_request(), _turn("b"))).allowed
        # The same turn asking again (a retried dispatch) is not a third turn.
        assert (await router.admit_sandbox(_request(), _turn("a"))).allowed
        assert not (await router.admit_sandbox(_request(), _turn("c"))).allowed
        response = await router.release_sandbox_turn(
            _request(), SandboxTurnRequest(turn_id="a")
        )
        assert response.status_code == 204
        assert (await router.admit_sandbox(_request(), _turn("c"))).allowed


async def test_running_turns_are_counted_per_organization():
    slots = InMemoryTurnSlots()
    router = _router(plan=HOBBY, slots=slots)
    with _caller():
        for turn in ("a", "b"):
            assert (await router.admit_sandbox(_request(), _turn(turn))).allowed
    with _caller():
        assert (await router.admit_sandbox(_request(), _turn("a"))).allowed


async def test_out_of_credit_is_refused_before_a_slot_is_taken_and_names_the_plan():
    slots = InMemoryTurnSlots()
    with _caller():
        refused = await _router(allowed=False, plan=PRO, slots=slots).admit_sandbox(
            _request(), _turn("a")
        )

    assert refused.allowed is False
    assert refused.code == "wallet_balance_exhausted"
    assert "Buy more credits to keep going" in refused.message
    assert "upgrade to Business" in refused.message
    assert all(not held for held in slots.held.values())


async def test_a_plan_without_caps_and_a_turn_without_an_id_are_not_capped():
    with _caller():
        internal = await _router(plan="cloud_v0_agenta_ai").admit_sandbox(
            _request(), _turn("a")
        )
        no_id = await _router(plan=HOBBY).admit_sandbox(_request(), None)

    assert internal.allowed and internal.turn_limit is None and not internal.slot_held
    assert no_id.allowed and no_id.turn_limit.seconds == 1800 and not no_id.slot_held


async def test_a_slot_store_that_cannot_answer_admits_uncounted():
    slots = InMemoryTurnSlots()
    slots.fail = True
    with _caller():
        admitted = await _router(plan=HOBBY, slots=slots).admit_sandbox(
            _request(), _turn("a")
        )

    assert admitted.allowed is True and admitted.slot_held is False
    assert admitted.turn_limit.seconds == 1800


async def test_an_organization_whose_wallet_is_off_is_never_capped(monkeypatch):
    from ee.src.core.wallets import admission
    from oss.src.core.rollout.switches import WalletMode

    async def _off(organization_id, *, wait=True):
        return WalletMode.OFF

    monkeypatch.setattr(admission, "wallet_mode_for", _off)
    slots = InMemoryTurnSlots()
    router = _router(allowed=False, plan=HOBBY, slots=slots)
    with _caller():
        answers = [
            await router.admit_sandbox(_request(), _turn(f"t-{i}")) for i in range(5)
        ]

    assert all(a.allowed and a.turn_limit is None and not a.slot_held for a in answers)
    assert slots.held == {}


async def test_a_heartbeat_takes_back_an_expired_hold():
    slots = InMemoryTurnSlots()
    router = _router(plan=HOBBY, slots=slots)
    with _caller() as scope:
        response = await router.renew_sandbox_turn(
            _request(), SandboxTurnRequest(turn_id="a")
        )

    assert response.status_code == 204
    assert slots.held[scope.organization_id] == {"a"}


async def test_a_recorded_interval_answers_its_measurement_id():
    publisher = InMemoryMeasurementPublisher()
    with _caller() as scope:
        response = await _router(publisher=publisher).record_sandbox_usage(
            _request(), _interval()
        )

    [published] = publisher.published
    assert response.measurement_id == published.measurement_id
    assert published.project_id == scope.project_id


async def test_an_unmetered_provider_is_a_422_the_runner_drops():
    with _caller():
        response = await _router().record_sandbox_usage(
            _request(), _interval(provider="local")
        )

    assert response.status_code == 422


async def test_a_failed_publish_is_a_503_the_runner_retries():
    publisher = InMemoryMeasurementPublisher()
    publisher.fail_next = True
    with _caller():
        response = await _router(publisher=publisher).record_sandbox_usage(
            _request(), _interval()
        )

    assert response.status_code == 503
    assert json.loads(response.body)["detail"]


def _app(publisher, scope):
    """The routes over HTTP, behind a stand-in for the auth middleware that resolves
    every request to `scope`: the tenant credential is valid, the question is the runner."""
    from fastapi import FastAPI

    app = FastAPI()

    @app.middleware("http")
    async def _authenticated(request, call_next):
        token = set_auth_context(
            AuthContext(credentials=SecretCredentials(value="user-key"), scope=scope)
        )
        try:
            return await call_next(request)
        finally:
            reset_auth_context(token)

    app.include_router(_router(publisher=publisher).router, prefix="/wallets")
    return app


_REPORT = {
    "provider": "daytona",
    "sandbox_id": "sb-1",
    "start_time": "2026-09-26T12:00:00Z",
    "end_time": "2026-09-26T12:01:00Z",
    "vcpu": 2,
    "memory_gib": 4,
}


@pytest.mark.parametrize(
    "path",
    [
        "/wallets/sandboxes/admit",
        "/wallets/sandboxes/usage",
        "/wallets/sandboxes/turns/heartbeat",
        "/wallets/sandboxes/turns/release",
    ],
)
@pytest.mark.parametrize(
    "headers",
    [{}, {"X-Agenta-Runner-Token": "not-the-token"}],
    ids=["tenant-credential-only", "wrong-runner-token"],
)
def test_a_tenant_credential_without_the_runner_token_is_refused(
    monkeypatch, path, headers
):
    from fastapi.testclient import TestClient

    # Through the module that reads it: another suite may have reloaded the env module.
    monkeypatch.setattr(runner_auth.env.runner, "token", "runner-secret")
    publisher = InMemoryMeasurementPublisher()
    scope = AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )

    response = TestClient(_app(publisher, scope)).post(
        path, json=_REPORT, headers={"Authorization": "ApiKey user-key", **headers}
    )

    assert response.status_code == 401
    assert publisher.published == []


def test_the_runner_reports_for_the_credential_tenant_not_the_body(monkeypatch):
    from fastapi.testclient import TestClient

    # Through the module that reads it: another suite may have reloaded the env module.
    monkeypatch.setattr(runner_auth.env.runner, "token", "runner-secret")
    publisher = InMemoryMeasurementPublisher()
    scope = AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )

    response = TestClient(_app(publisher, scope)).post(
        "/wallets/sandboxes/usage",
        json={**_REPORT, "organization_id": str(uuid4()), "project_id": str(uuid4())},
        headers={
            "Authorization": "Access run-token",
            "X-Agenta-Runner-Token": "runner-secret",
        },
    )

    assert response.status_code == 200
    [published] = publisher.published
    assert (published.organization_id, published.project_id) == (
        scope.organization_id,
        scope.project_id,
    )
