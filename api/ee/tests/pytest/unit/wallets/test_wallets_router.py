"""The wallet read routes: which permission each asks for, and a bad window is a 400."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.core.access.permissions.types import Permission

from ee.src.apis.fastapi.wallets import router as router_module
from ee.src.core.wallets.errors import InvalidUsageWindowError
from ee.src.core.wallets.usage.dtos import WalletUsageSummary


class _Service:
    async def summary(self, *, organization_id):
        return WalletUsageSummary(active_credit_total_musd=0, credits=[])

    async def usage(self, *, organization_id, start, end):
        raise InvalidUsageWindowError("start must be before end")


@pytest.fixture
def client_granting(monkeypatch):
    def _client(granted):
        asked = []

        async def _check(*, user_uid, project_id, permission):
            asked.append(permission)
            return permission in granted

        monkeypatch.setattr(router_module, "check_action_access", _check)
        monkeypatch.setattr(
            router_module,
            "get_auth_scope",
            lambda: SimpleNamespace(organization_id=uuid4()),
        )
        app = FastAPI()

        @app.middleware("http")
        async def _principal(request, call_next):
            request.state.user_id = str(uuid4())
            request.state.project_id = str(uuid4())
            return await call_next(request)

        app.include_router(
            router_module.WalletsRouter(
                wallet_usage_service=_Service(), sandbox_usage_service=None
            ).router,
            prefix="/wallets",
        )
        return TestClient(app), asked

    return _client


def test_a_billing_viewer_reads_the_summary_but_not_the_usage_detail(
    client_granting,
):
    client, asked = client_granting({Permission.VIEW_BILLING})

    assert client.get("/wallets/summary").status_code == 200
    assert client.post("/wallets/usage/query", json={}).status_code == 403
    assert asked == [Permission.VIEW_BILLING, Permission.EDIT_BILLING]


def test_an_invalid_usage_window_is_a_bad_request(client_granting):
    client, _ = client_granting({Permission.EDIT_BILLING})

    response = client.post("/wallets/usage/query", json={})

    assert response.status_code == 400


def test_the_summary_states_the_organizations_wallet_mode(client_granting, monkeypatch):
    from oss.src.core.rollout.switches import WalletMode

    async def _enforce(organization_id, *, wait=True):
        return WalletMode.ENFORCE

    monkeypatch.setattr(router_module, "wallet_mode_for", _enforce)
    client, _ = client_granting({Permission.VIEW_BILLING})

    response = client.get("/wallets/summary")

    assert response.status_code == 200
    assert response.json()["mode"] == "enforce"
