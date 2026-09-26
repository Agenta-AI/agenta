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

from ee.src.apis.fastapi.wallets.router import WalletsRouter
from ee.src.core.measurements.sandboxes import (
    SandboxUsageInterval,
    SandboxUsageService,
)
from ee.tests.pytest.utils.measurements.fakes import InMemoryMeasurementPublisher

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


def _router(*, allowed=True, publisher=None):
    return WalletsRouter(
        wallet_usage_service=None,
        sandbox_usage_service=SandboxUsageService(
            wallet=_Wallet(allowed),
            publisher=publisher or InMemoryMeasurementPublisher(),
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
