"""The subscription login routes: shapes, status codes, and the permission each one needs.

Drives the real `VaultRouter` over the real `VaultService` and `SubscriptionLoginService`,
with an in-memory DAO and a scripted runner. The permission check is replaced by a recorder
so each route's required permissions are asserted, not assumed.
"""

from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from json import dumps as json_dumps
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.vault import router as vault_router_module
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.access.permissions.types import Permission
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import RunnerLoginAttempt
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.src.core.secrets.types import (
    SubscriptionLoginRunnerNotConfigured,
    SubscriptionLoginRunnerUnavailable,
)
from oss.src.dbs.postgres.secrets.mappings import (
    map_secrets_dbe_to_dto,
    map_secrets_dto_to_dbe,
    map_secrets_dto_to_dbe_update,
)


PROJECT_ID = str(uuid4())
USER_ID = str(uuid4())

_HOUR_MS = 3_600_000


def _access_token(account_id: str = "acct-1") -> str:
    """An access token shaped like Codex's. The signature is filler; nothing checks it."""

    def segment(payload: dict) -> str:
        return urlsafe_b64encode(json_dumps(payload).encode()).decode().rstrip("=")

    header = segment({"alg": "RS256", "typ": "JWT"})
    claims = segment(
        {"https://api.openai.com/auth": {"chatgpt_account_id": account_id}}
    )
    return f"{header}.{claims}.c2lnbmF0dXJl"


def _expires_in(hours: float) -> int:
    """An absolute expiry in epoch milliseconds, the unit Pi writes."""
    return int(datetime.now(timezone.utc).timestamp() * 1000) + int(hours * _HOUR_MS)


LOGIN = {
    "type": "oauth",
    "access": _access_token(),
    "refresh": "refresh-1",
    "expires": _expires_in(1),
    "accountId": "acct-1",
}


def _later(minutes: int = 10) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


class _FakeSecretsDAO:
    def __init__(self):
        self.rows: dict = {}

    async def create(
        self, project_id, organization_id, create_secret_dto, management=None
    ):
        dbe = map_secrets_dto_to_dbe(
            project_id=project_id,
            organization_id=organization_id,
            secret_dto=create_secret_dto,
        )
        dbe.id = uuid4()
        self.rows[str(dbe.id)] = dbe
        return map_secrets_dbe_to_dto(secrets_dbe=dbe)

    async def list(self, project_id, organization_id):
        return [map_secrets_dbe_to_dto(secrets_dbe=dbe) for dbe in self.rows.values()]

    async def get_by_id(self, secret_id, project_id, organization_id):
        dbe = self.rows.get(str(secret_id))
        return map_secrets_dbe_to_dto(secrets_dbe=dbe) if dbe else None

    async def get_by_slug(self, secret_slug, project_id, organization_id):
        for dbe in self.rows.values():
            if dbe.slug == secret_slug:
                return map_secrets_dbe_to_dto(secrets_dbe=dbe)
        return None

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        dbe = self.rows.get(str(secret_id))
        if dbe is None:
            return None
        if resolve_update is not None:
            update_secret_dto = resolve_update(
                map_secrets_dbe_to_dto(secrets_dbe=dbe),
                update_secret_dto,
            )
        map_secrets_dto_to_dbe_update(
            secrets_dbe=dbe,
            update_secret_dto=update_secret_dto,
            user_id=user_id,
        )
        return map_secrets_dbe_to_dto(secrets_dbe=dbe)

    async def delete(
        self, secret_id, project_id, organization_id, authorize_delete=None
    ):
        self.rows.pop(str(secret_id), None)


class _FakeRunner:
    def __init__(self):
        self.next_attempt = None
        self.raises = None
        self.deleted: list = []

    async def start_attempt(self, *, provider):
        if self.raises is not None:
            raise self.raises
        return self.next_attempt

    async def read_attempt(self, *, attempt_id):
        if self.raises is not None:
            raise self.raises
        return self.next_attempt

    async def delete_attempt(self, *, attempt_id):
        self.deleted.append(attempt_id)
        return True


class _Harness:
    def __init__(self, client, runner, asked):
        self.client = client
        self.runner = runner
        self.asked = asked


@pytest.fixture(name="harness")
def _harness(monkeypatch):
    dao = _FakeSecretsDAO()
    runner = _FakeRunner()
    asked: list = []

    async def _record(**kwargs):
        asked.append(kwargs["permission"])
        return True

    monkeypatch.setattr(vault_router_module, "check_action_access", _record)

    app = FastAPI()

    @app.middleware("http")
    async def _principal(request, call_next):
        request.state.user_id = USER_ID
        request.state.project_id = PROJECT_ID
        return await call_next(request)

    vault_service = VaultService(dao)
    app.include_router(
        VaultRouter(
            vault_service=vault_service,
            subscription_login_service=SubscriptionLoginService(
                vault_service=vault_service,
                runner_client=runner,
            ),
        ).router
    )

    return _Harness(TestClient(app), runner, asked)


def _create(client, data=None):
    response = client.post(
        "/secrets/",
        json={
            "header": {"name": "ChatGPT"},
            "secret": {"kind": "subscription_provider", "data": data or {}},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestCreateAndRead:
    def test_a_created_connection_hides_the_login_and_shows_its_models(self, harness):
        created = _create(harness.client, {"login": LOGIN, "login_state": "ready"})

        # The vault routes exclude nulls, so a redacted login is an absent key.
        assert "login" not in created["data"]
        assert created["data"]["login_state"] == "ready"
        assert created["data"]["model_keys"][0] == "chatgpt/gpt-5.6-sol"
        assert created["value_status"]["configured"] is True
        assert LOGIN["access"] not in harness.client.get("/secrets/").text

    def test_a_second_chatgpt_connection_is_a_conflict(self, harness):
        _create(harness.client)

        response = harness.client.post(
            "/secrets/",
            json={
                "header": {"name": "ChatGPT"},
                "secret": {"kind": "subscription_provider", "data": {}},
            },
        )

        assert response.status_code == 409


class TestLoginAttemptRoutes:
    def test_start_returns_the_user_code_and_needs_edit_secret(self, harness):
        created = _create(harness.client)
        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1",
            state="pending",
            user_code="ABCD-EFGH",
            verification_uri="https://example.test/device",
            expires_at=_later(),
            poll_after_ms=5000,
        )
        harness.asked.clear()

        response = harness.client.post(f"/secrets/{created['id']}/login-attempts")

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["attempt_id"] == "att-1"
        assert body["state"] == "pending"
        assert body["user_code"] == "ABCD-EFGH"
        assert body["verification_uri"] == "https://example.test/device"
        assert body["poll_after_ms"] == 5000
        assert harness.asked == [Permission.EDIT_SECRET]

    def test_a_succeeded_poll_stores_the_login_without_returning_it(self, harness):
        created = _create(harness.client)
        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="pending", expires_at=_later()
        )
        harness.client.post(f"/secrets/{created['id']}/login-attempts")

        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="succeeded", login=LOGIN
        )
        response = harness.client.get(f"/secrets/{created['id']}/login-attempts/att-1")

        assert response.status_code == 200, response.text
        assert response.json()["state"] == "succeeded"
        assert LOGIN["access"] not in response.text

        read_back = harness.client.get(f"/secrets/{created['id']}").json()
        assert "login" not in read_back["data"]
        assert "login_attempt" not in read_back["data"]
        assert read_back["data"]["login_state"] == "ready"
        assert read_back["data"]["login_version"] == 1
        assert read_back["data"]["login_generation"] == 1

    def test_polling_an_attempt_this_connection_never_started_is_404(self, harness):
        created = _create(harness.client)

        response = harness.client.get(
            f"/secrets/{created['id']}/login-attempts/att-someone-else"
        )

        assert response.status_code == 404

    def test_cancel_returns_the_cancelled_state(self, harness):
        created = _create(harness.client)
        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="pending", expires_at=_later()
        )
        harness.client.post(f"/secrets/{created['id']}/login-attempts")

        response = harness.client.post(
            f"/secrets/{created['id']}/login-attempts/att-1/cancel"
        )

        assert response.status_code == 200, response.text
        assert response.json()["state"] == "cancelled"
        assert harness.runner.deleted == ["att-1"]

    def test_no_runner_configured_is_a_503(self, harness):
        created = _create(harness.client)
        harness.runner.raises = SubscriptionLoginRunnerNotConfigured()

        response = harness.client.post(f"/secrets/{created['id']}/login-attempts")

        assert response.status_code == 503
        assert "runner" in response.json()["detail"]

    def test_an_unreachable_runner_is_a_502(self, harness):
        created = _create(harness.client)
        harness.runner.raises = SubscriptionLoginRunnerUnavailable()

        response = harness.client.post(f"/secrets/{created['id']}/login-attempts")

        assert response.status_code == 502

    def test_a_login_attempt_on_a_missing_connection_is_404(self, harness):
        response = harness.client.post(f"/secrets/{uuid4()}/login-attempts")

        assert response.status_code == 404


class TestRunnerFacingRoutes:
    def test_a_refreshed_login_is_stored_under_the_run_permissions(self, harness):
        created = _create(
            harness.client,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )
        harness.asked.clear()

        response = harness.client.post(
            f"/secrets/{created['id']}/subscription-login",
            json={
                "login": {**LOGIN, "refresh": "refresh-2", "expires": _expires_in(2)},
                "version": 3,
                "generation": 1,
            },
        )

        assert response.status_code == 200, response.text
        assert response.json() == {
            "version": 4,
            "generation": 1,
            "updated": True,
            "stale": False,
        }
        assert harness.asked == [Permission.RUN_SESSIONS, Permission.USE_MOUNTS]

    def test_an_unusable_login_is_refused_with_a_reason_and_changes_nothing(
        self, harness
    ):
        created = _create(
            harness.client,
            {
                "login": LOGIN,
                "login_version": 3,
                "login_generation": 1,
                "login_state": "ready",
            },
        )

        response = harness.client.post(
            f"/secrets/{created['id']}/subscription-login",
            json={
                # What a run sends when its own refresh went wrong: not a token, but a
                # later expiry, so every ordering rule would have ranked it first.
                "login": {
                    **LOGIN,
                    "access": "not-a-jwt",
                    "refresh": "refresh-2",
                    "expires": _expires_in(9),
                },
                "version": 3,
                "generation": 1,
            },
        )

        assert response.status_code == 200, response.text
        assert response.json() == {
            "version": 3,
            "generation": 1,
            "updated": False,
            "stale": False,
            "reason": "invalid_login",
        }

        read_back = harness.client.get(f"/secrets/{created['id']}").json()
        assert read_back["data"]["login_version"] == 3
        assert read_back["data"]["login_state"] == "ready"

    def test_the_same_refresh_token_is_an_idempotent_no_op(self, harness):
        created = _create(
            harness.client,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )

        response = harness.client.post(
            f"/secrets/{created['id']}/subscription-login",
            json={
                "login": {**LOGIN, "expires": _expires_in(9)},
                "version": 3,
                "generation": 1,
            },
        )

        assert response.json() == {
            "version": 3,
            "generation": 1,
            "updated": False,
            "stale": False,
        }

    def test_an_older_generation_gets_the_current_login_back(self, harness):
        created = _create(
            harness.client,
            {"login": LOGIN, "login_version": 3, "login_generation": 4},
        )

        response = harness.client.post(
            f"/secrets/{created['id']}/subscription-login",
            json={
                "login": {**LOGIN, "refresh": "refresh-old", "expires": _expires_in(9)},
                "version": 3,
                "generation": 1,
            },
        )

        body = response.json()
        assert body["stale"] is True
        assert body["updated"] is False
        assert body["generation"] == 4
        assert body["login"]["refresh"] == "refresh-1"

    def test_a_login_for_another_account_is_not_stored(self, harness):
        created = _create(
            harness.client,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )

        response = harness.client.post(
            f"/secrets/{created['id']}/subscription-login",
            json={
                "login": {
                    **LOGIN,
                    "accountId": "acct-2",
                    "refresh": "refresh-2",
                    "expires": _expires_in(9),
                },
                "version": 3,
                "generation": 1,
            },
        )

        assert response.json()["updated"] is False
        assert "login" not in response.json()

    def test_an_empty_login_is_refused(self, harness):
        created = _create(harness.client, {"login": LOGIN, "login_version": 3})

        response = harness.client.post(
            f"/secrets/{created['id']}/subscription-login",
            json={"login": {}, "version": 3, "generation": 0},
        )

        assert response.status_code == 422

    def test_a_push_without_a_generation_is_refused(self, harness):
        created = _create(harness.client, {"login": LOGIN, "login_version": 3})

        response = harness.client.post(
            f"/secrets/{created['id']}/subscription-login",
            json={"login": LOGIN, "version": 3},
        )

        assert response.status_code == 422

    def test_a_failure_report_marks_the_login_dead(self, harness):
        created = _create(
            harness.client,
            {
                "login": LOGIN,
                "login_version": 3,
                "login_generation": 1,
                "login_state": "ready",
            },
        )
        harness.asked.clear()

        response = harness.client.post(
            f"/secrets/{created['id']}/subscription-login/failure",
            json={"version": 3, "generation": 1, "reason": "refresh_rejected"},
        )

        assert response.status_code == 200, response.text
        assert response.json() == {"stale": False, "version": 3, "generation": 1}
        assert harness.asked == [Permission.RUN_SESSIONS, Permission.USE_MOUNTS]

        read_back = harness.client.get(f"/secrets/{created['id']}").json()
        assert read_back["data"]["login_state"] == "needs_login"
        assert read_back["data"]["login_error"] == "refresh_rejected"

    def test_a_stale_failure_report_returns_the_current_login(self, harness):
        created = _create(
            harness.client,
            {
                "login": LOGIN,
                "login_version": 5,
                "login_generation": 1,
                "login_state": "ready",
            },
        )

        response = harness.client.post(
            f"/secrets/{created['id']}/subscription-login/failure",
            json={"version": 3, "generation": 1, "reason": "refresh_rejected"},
        )

        body = response.json()
        assert body["stale"] is True
        assert body["version"] == 5
        assert body["login"]["refresh"] == "refresh-1"

        read_back = harness.client.get(f"/secrets/{created['id']}").json()
        assert read_back["data"]["login_state"] == "ready"
