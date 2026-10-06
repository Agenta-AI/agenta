"""The subscription login routes: shapes, status codes, and the permission each one needs.

Drives the real `VaultRouter` over the real `VaultService` and `SubscriptionLoginService`,
with an in-memory DAO and a scripted runner. The permission check is replaced by a recorder
so each route's required permissions are asserted, not assumed.
"""

from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from json import dumps as json_dumps, loads as json_loads
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.providers.router import ProvidersRouter
from oss.src.apis.fastapi.shared import runner_auth
from oss.src.apis.fastapi.vault import router as vault_router_module
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.access.permissions.types import Permission
from oss.src.core.providers.service import ProviderProbeService
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import RunnerLoginAttempt
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.src.core.secrets.types import (
    SubscriptionLoginRunnerNotConfigured,
    SubscriptionLoginRunnerUnavailable,
)
from oss.src.middlewares.auth import _PUBLIC_ENDPOINTS, SECRET_RESOLVE_GRANT
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
            resolved = resolve_update(
                map_secrets_dbe_to_dto(secrets_dbe=dbe),
                update_secret_dto,
            )
            if resolved is None:
                return map_secrets_dbe_to_dto(secrets_dbe=dbe)
            update_secret_dto = resolved
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
        self.deleted_at: list = []

    async def start_attempt(self, *, provider, project_id, secret_id):
        if self.raises is not None:
            raise self.raises
        return self.next_attempt

    async def delete_attempt(self, *, attempt_id, base_url=None):
        self.deleted.append(attempt_id)
        self.deleted_at.append(base_url)
        return True


RUNNER_TOKEN = "runner-secret"
RUNNER_HEADERS = {"X-Agenta-Runner-Token": RUNNER_TOKEN}


# The two routes only a run's own credential may call. Everything else in this file is a
# browser: a session and an ApiKey carry no grants, which is what keeps a write-only value
# out of every ordinary read.
_RUNTIME_ROUTES = ("/subscription-login", "/subscription-login/failure")

# The route the runner pod that ran a device login reports its outcome on.
_OUTCOME_PREFIX = "/secrets/subscription-login/attempts/"


def _outcome_url(attempt_id: str) -> str:
    return f"{_OUTCOME_PREFIX}{attempt_id}/outcome"


class _Harness:
    def __init__(self, client, runner, asked, dao, principal):
        self.client = client
        self.runner = runner
        self.asked = asked
        self.dao = dao
        self._principal = principal

    def as_an_editor(self) -> None:
        """Take the runtime grant off every route, leaving permissions only.

        What an editor session or a project ApiKey reaches the API with. It is the caller
        the two login-upkeep routes must refuse.
        """
        self._principal["granted"] = False


@pytest.fixture(name="harness")
def _harness(monkeypatch):
    dao = _FakeSecretsDAO()
    runner = _FakeRunner()
    asked: list = []
    principal = {"granted": True}

    async def _record(**kwargs):
        asked.append(kwargs["permission"])
        return True

    monkeypatch.setattr(vault_router_module, "check_action_access", _record)
    monkeypatch.setattr(runner_auth.env.runner, "token", RUNNER_TOKEN)

    app = FastAPI()

    @app.middleware("http")
    async def _principal(request, call_next):
        # The auth middleware exempts the outcome route, so it reaches the handler with no
        # tenant principal at all.
        if request.url.path.startswith(_OUTCOME_PREFIX):
            return await call_next(request)
        request.state.user_id = USER_ID
        request.state.project_id = PROJECT_ID
        runtime_route = request.url.path.endswith(_RUNTIME_ROUTES)
        request.state.token_grants = (
            (SECRET_RESOLVE_GRANT,) if runtime_route and principal["granted"] else ()
        )
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

    return _Harness(TestClient(app), runner, asked, dao, principal)


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


def _seed(harness, secret_id, data: dict) -> None:
    """Put server-owned login state straight on the stored row.

    Create and update refuse these fields, so a test that needs a signed-in connection
    writes the row itself instead of posting a state the routes would reject.
    """
    dbe = harness.dao.rows[str(secret_id)]
    stored = json_loads(dbe.data)
    stored.update(data)
    dbe.data = json_dumps(stored)


def _signed_in(harness, data: dict | None = None) -> str:
    """A connection id whose row already holds a login."""
    secret_id = _create(harness.client)["id"]
    _seed(harness, secret_id, {"login": LOGIN, "login_state": "ready", **(data or {})})
    return secret_id


class TestCreateAndRead:
    def test_a_signed_in_connection_hides_the_login_and_shows_its_models(self, harness):
        secret_id = _signed_in(harness)

        read = harness.client.get(f"/secrets/{secret_id}").json()

        # The vault routes exclude nulls, so a redacted login is an absent key.
        assert "login" not in read["data"]
        assert read["data"]["login_state"] == "ready"
        assert read["data"]["model_keys"][0] == "chatgpt/gpt-6.1-sol"
        assert read["value_status"]["configured"] is True
        assert LOGIN["access"] not in harness.client.get("/secrets/").text

    def test_a_create_that_states_a_server_owned_field_is_refused(self, harness):
        response = harness.client.post(
            "/secrets/",
            json={
                "header": {"name": "ChatGPT"},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"login": LOGIN, "login_state": "ready"},
                },
            },
        )

        assert response.status_code == 422
        assert "login_state" in response.json()["detail"]
        assert LOGIN["access"] not in response.text

    def test_an_update_cannot_rewind_the_login_state(self, harness):
        secret_id = _signed_in(harness, {"login_version": 4, "login_generation": 2})

        response = harness.client.put(
            f"/secrets/{secret_id}",
            json={
                "header": {"name": "ChatGPT"},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"login_version": 0, "login_generation": 0},
                },
            },
        )

        assert response.status_code == 422
        read = harness.client.get(f"/secrets/{secret_id}").json()
        assert read["data"]["login_version"] == 4
        assert read["data"]["login_generation"] == 2

    def test_a_rename_keeps_the_stored_sign_in(self, harness):
        secret_id = _signed_in(harness, {"login_version": 4})

        response = harness.client.put(
            f"/secrets/{secret_id}",
            json={
                "header": {"name": "My ChatGPT"},
                "secret": {"kind": "subscription_provider", "data": {}},
            },
        )

        assert response.status_code == 200, response.text
        read = harness.client.get(f"/secrets/{secret_id}").json()
        assert read["header"]["name"] == "My ChatGPT"
        assert read["data"]["login_state"] == "ready"
        assert read["data"]["login_version"] == 4
        assert read["value_status"]["configured"] is True

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
        secret_id = _create(harness.client)["id"]
        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1",
            state="pending",
            user_code="ABCD-EFGH",
            verification_uri="https://example.test/device",
            expires_at=_later(),
            poll_after_ms=5000,
        )
        harness.asked.clear()

        response = harness.client.post(f"/secrets/{secret_id}/login-attempts")

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["attempt_id"] == "att-1"
        assert body["state"] == "pending"
        assert body["user_code"] == "ABCD-EFGH"
        assert body["verification_uri"] == "https://example.test/device"
        assert body["poll_after_ms"] == 5000
        assert harness.asked == [Permission.EDIT_SECRET]

    def test_a_succeeded_poll_stores_the_login_without_returning_it(self, harness):
        secret_id = _create(harness.client)["id"]
        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="pending", expires_at=_later()
        )
        harness.client.post(f"/secrets/{secret_id}/login-attempts")

        reported = harness.client.post(
            _outcome_url("att-1"),
            headers=RUNNER_HEADERS,
            json={
                "project_id": PROJECT_ID,
                "secret_id": secret_id,
                "state": "succeeded",
                "login": LOGIN,
            },
        )
        assert reported.status_code == 204, reported.text
        response = harness.client.get(f"/secrets/{secret_id}/login-attempts/att-1")

        assert response.status_code == 200, response.text
        assert response.json()["state"] == "succeeded"
        assert LOGIN["access"] not in response.text

        read_back = harness.client.get(f"/secrets/{secret_id}").json()
        assert "login" not in read_back["data"]
        assert "login_attempt" not in read_back["data"]
        assert read_back["data"]["login_state"] == "ready"
        assert read_back["data"]["login_version"] == 1
        assert read_back["data"]["login_generation"] == 1

    def test_polling_an_attempt_this_connection_never_started_is_404(self, harness):
        secret_id = _create(harness.client)["id"]

        response = harness.client.get(
            f"/secrets/{secret_id}/login-attempts/att-someone-else"
        )

        assert response.status_code == 404

    def test_cancel_returns_the_cancelled_state(self, harness):
        secret_id = _create(harness.client)["id"]
        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1",
            state="pending",
            expires_at=_later(),
            runner_address="http://10.8.2.17:8765",
        )
        harness.client.post(f"/secrets/{secret_id}/login-attempts")

        response = harness.client.post(
            f"/secrets/{secret_id}/login-attempts/att-1/cancel"
        )

        assert response.status_code == 200, response.text
        assert response.json()["state"] == "cancelled"
        assert harness.runner.deleted == ["att-1"]
        assert harness.runner.deleted_at == ["http://10.8.2.17:8765"]

    def test_no_runner_configured_is_a_503(self, harness):
        secret_id = _create(harness.client)["id"]
        harness.runner.raises = SubscriptionLoginRunnerNotConfigured()

        response = harness.client.post(f"/secrets/{secret_id}/login-attempts")

        assert response.status_code == 503
        assert "runner" in response.json()["detail"]

    def test_an_unreachable_runner_is_a_502(self, harness):
        secret_id = _create(harness.client)["id"]
        harness.runner.raises = SubscriptionLoginRunnerUnavailable()

        response = harness.client.post(f"/secrets/{secret_id}/login-attempts")

        assert response.status_code == 502

    def test_a_login_attempt_on_a_missing_connection_is_404(self, harness):
        response = harness.client.post(f"/secrets/{uuid4()}/login-attempts")

        assert response.status_code == 404


class TestTheOutcomeRoute:
    """The runner pod that ran a device login reports how it ended.

    It holds no project credential, so the shared runner token is the whole of the gate,
    and the attempt id binding on the row is what scopes the write.
    """

    def _started(self, harness) -> str:
        secret_id = _create(harness.client)["id"]
        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="pending", expires_at=_later()
        )
        started = harness.client.post(f"/secrets/{secret_id}/login-attempts")
        assert started.status_code == 200, started.text
        return secret_id

    def _report(self, harness, secret_id, headers=RUNNER_HEADERS, **body):
        return harness.client.post(
            _outcome_url(body.pop("attempt_id", "att-1")),
            headers=headers,
            json={"project_id": PROJECT_ID, "secret_id": secret_id, **body},
        )

    @pytest.mark.parametrize(
        "headers",
        [
            {},
            {"X-Agenta-Runner-Token": "not-the-token"},
            {"Authorization": "Bearer not-the-token"},
        ],
    )
    def test_a_caller_without_the_runner_token_is_refused_and_writes_nothing(
        self, harness, headers
    ):
        secret_id = self._started(harness)

        response = self._report(
            harness, secret_id, headers=headers, state="succeeded", login=LOGIN
        )

        assert response.status_code == 401
        read = harness.client.get(f"/secrets/{secret_id}").json()
        assert read["data"]["login_state"] == "pending_login"
        assert read["data"]["login_version"] == 0
        assert (
            harness.client.get(f"/secrets/{secret_id}/login-attempts/att-1").json()[
                "state"
            ]
            == "pending"
        )

    def test_the_bearer_form_of_the_runner_token_is_accepted(self, harness):
        secret_id = self._started(harness)

        response = self._report(
            harness,
            secret_id,
            headers={"Authorization": f"Bearer {RUNNER_TOKEN}"},
            state="failed",
            error="login_failed",
        )

        assert response.status_code == 204, response.text

    def test_a_failure_polls_as_that_state_and_reason_then_clears(self, harness):
        secret_id = self._started(harness)

        reported = self._report(harness, secret_id, state="expired", error="timed_out")
        polled = harness.client.get(f"/secrets/{secret_id}/login-attempts/att-1")
        again = harness.client.get(f"/secrets/{secret_id}/login-attempts/att-1")

        assert reported.status_code == 204, reported.text
        assert polled.status_code == 200, polled.text
        assert polled.json()["state"] == "expired"
        assert polled.json()["error"] == "timed_out"
        assert again.status_code == 404

    def test_a_report_for_a_cancelled_attempt_is_404_and_writes_nothing(self, harness):
        secret_id = self._started(harness)
        harness.client.post(f"/secrets/{secret_id}/login-attempts/att-1/cancel")

        response = self._report(harness, secret_id, state="succeeded", login=LOGIN)

        assert response.status_code == 404
        read = harness.client.get(f"/secrets/{secret_id}").json()
        assert read["data"]["login_state"] == "pending_login"
        assert read["data"]["login_version"] == 0

    def test_a_report_for_another_connections_row_is_404(self, harness):
        secret_id = self._started(harness)

        response = self._report(harness, str(uuid4()), state="succeeded", login=LOGIN)

        assert response.status_code == 404
        assert (
            harness.client.get(f"/secrets/{secret_id}").json()["data"]["login_version"]
            == 0
        )

    def test_an_unknown_state_is_refused_without_echoing_the_body(self, harness):
        secret_id = self._started(harness)

        response = self._report(harness, secret_id, state="cancelled", login=LOGIN)

        assert response.status_code == 422
        assert LOGIN["access"] not in response.text

    def test_the_route_is_exempt_from_tenant_auth_and_nothing_else_is(self):
        assert _outcome_url("att-1").startswith(_PUBLIC_ENDPOINTS)
        assert f"/api{_outcome_url('att-1')}".startswith(_PUBLIC_ENDPOINTS)
        secret_id = str(uuid4())
        for path in (
            f"/secrets/{secret_id}/login-attempts",
            f"/secrets/{secret_id}/login-attempts/att-1",
            f"/secrets/{secret_id}/subscription-login",
            f"/vault/v1{_outcome_url('att-1')}",
            "/secrets/",
        ):
            assert not path.startswith(_PUBLIC_ENDPOINTS), path

    def test_the_outcome_route_is_the_only_route_under_the_public_prefix(self):
        """A route added later under the public prefix would skip tenant auth silently.

        Walks the real route tables of every router mounted under `/secrets/`. A template
        can serve a path under the prefix when each of its leading segments is the prefix's
        literal or a path parameter, which a caller can fill with that literal.
        """
        vault_service = VaultService(_FakeSecretsDAO())
        routers = [
            VaultRouter(
                vault_service=vault_service,
                subscription_login_service=SubscriptionLoginService(
                    vault_service=vault_service,
                    runner_client=_FakeRunner(),
                ),
            ).router,
            ProvidersRouter(
                provider_probe_service=ProviderProbeService(),
                vault_service=vault_service,
            ).router,
        ]
        prefixes = {
            entry.removeprefix("/api")
            for entry in _PUBLIC_ENDPOINTS
            if entry.removeprefix("/api").startswith("/secrets/")
        }
        assert prefixes == {_OUTCOME_PREFIX}

        def can_serve(template: str, prefix: str) -> bool:
            wanted = prefix.strip("/").split("/")
            segments = template.strip("/").split("/")
            return len(segments) >= len(wanted) and all(
                segment == literal or segment.startswith("{")
                for segment, literal in zip(segments, wanted)
            )

        public = sorted(
            (route.path, tuple(sorted(route.methods)))
            for router in routers
            for route in router.routes
            if any(can_serve(route.path, prefix) for prefix in prefixes)
        )

        assert public == [
            ("/secrets/subscription-login/attempts/{attempt_id}/outcome", ("POST",))
        ]

    def test_a_caller_without_the_token_gets_401_before_any_body_check(self, harness):
        response = harness.client.post(
            _outcome_url("att-1"), json={"state": "not-a-state"}
        )

        assert response.status_code == 401
        assert "project_id" not in response.text


class TestRunnerFacingRoutes:
    def test_a_refreshed_login_is_stored_under_the_run_permissions(self, harness):
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )
        harness.asked.clear()

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
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
        secret_id = _signed_in(
            harness,
            {
                "login": LOGIN,
                "login_version": 3,
                "login_generation": 1,
                "login_state": "ready",
            },
        )

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
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

        read_back = harness.client.get(f"/secrets/{secret_id}").json()
        assert read_back["data"]["login_version"] == 3
        assert read_back["data"]["login_state"] == "ready"

    def test_the_same_refresh_token_is_an_idempotent_no_op(self, harness):
        """`same_login` is the one refusal that tells a run its credential IS current.

        The runner learns the row's version from a push only when the row stored its
        credential or already holds it. Answering a no-op the way a refusal answers left it
        unable to tell "you are up to date" from "the row kept something else".
        """
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
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
            "reason": "same_login",
        }

    def test_each_refusal_names_itself_and_none_of_them_says_same_login(self, harness):
        """One slug per outcome, so no refusal can be read as "you are up to date"."""
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )

        pushes = {
            # A credential the row cannot use, whatever lineage it claims.
            "invalid_login": {
                "login": {
                    **LOGIN,
                    "access": "not-a-jwt",
                    "refresh": "refresh-2",
                    "expires": _expires_in(9),
                },
                "version": 3,
                "generation": 1,
            },
            # A different ChatGPT account, self-consistent so it clears the shape check.
            "other_account": {
                "login": {
                    **LOGIN,
                    "access": _access_token("acct-2"),
                    "accountId": "acct-2",
                    "refresh": "refresh-2",
                    "expires": _expires_in(9),
                },
                "version": 3,
                "generation": 1,
            },
            # The same lineage and account, but older than what the row holds.
            "older_login": {
                "login": {
                    **LOGIN,
                    "refresh": "refresh-2",
                    "expires": _expires_in(0.5),
                },
                "version": 3,
                "generation": 1,
            },
            # A lineage this row has never issued.
            "wrong_generation": {
                "login": {**LOGIN, "refresh": "refresh-2", "expires": _expires_in(9)},
                "version": 3,
                "generation": 7,
            },
        }

        for expected, body in pushes.items():
            response = harness.client.post(
                f"/secrets/{secret_id}/subscription-login", json=body
            )

            assert response.status_code == 200, response.text
            answer = response.json()
            assert answer["reason"] == expected, expected
            assert answer["updated"] is False
            assert answer["stale"] is False

        # Nothing above moved the row.
        read_back = harness.client.get(f"/secrets/{secret_id}").json()
        assert read_back["data"]["login_version"] == 3

    def test_a_push_to_a_connection_that_holds_no_login_says_so(self, harness):
        secret_id = _create(harness.client)["id"]

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
            json={"login": LOGIN, "version": 0, "generation": 0},
        )

        assert response.status_code == 200, response.text
        assert response.json()["reason"] == "no_login"
        assert response.json()["updated"] is False

    def test_an_accepted_push_and_a_stale_answer_carry_no_reason(self, harness):
        """`updated` and `stale` already say what those two are."""
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )

        accepted = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
            json={
                "login": {**LOGIN, "refresh": "refresh-2", "expires": _expires_in(2)},
                "version": 3,
                "generation": 1,
            },
        ).json()

        assert accepted["updated"] is True
        assert "reason" not in accepted

        stale = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
            json={
                "login": {**LOGIN, "refresh": "refresh-3", "expires": _expires_in(9)},
                "version": 0,
                "generation": 0,
            },
        ).json()

        assert stale["stale"] is True
        assert "reason" not in stale

    def test_an_older_generation_gets_the_current_login_back(self, harness):
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 3, "login_generation": 4},
        )

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
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
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
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
        secret_id = _signed_in(harness, {"login_version": 3})

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
            json={"login": {}, "version": 3, "generation": 0},
        )

        assert response.status_code == 422

    def test_a_push_without_a_generation_is_refused(self, harness):
        secret_id = _signed_in(harness, {"login_version": 3})

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
            json={"login": LOGIN, "version": 3},
        )

        assert response.status_code == 422

    def test_a_failure_report_marks_the_login_dead(self, harness):
        secret_id = _signed_in(
            harness,
            {
                "login": LOGIN,
                "login_version": 3,
                "login_generation": 1,
                "login_state": "ready",
            },
        )
        harness.asked.clear()

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login/failure",
            json={"version": 3, "generation": 1, "reason": "refresh_rejected"},
        )

        assert response.status_code == 200, response.text
        assert response.json() == {"stale": False, "version": 3, "generation": 1}
        assert harness.asked == [Permission.RUN_SESSIONS, Permission.USE_MOUNTS]

        read_back = harness.client.get(f"/secrets/{secret_id}").json()
        assert read_back["data"]["login_state"] == "needs_login"
        assert read_back["data"]["login_error"] == "refresh_rejected"

    def test_a_stale_failure_report_returns_the_current_login(self, harness):
        secret_id = _signed_in(
            harness,
            {
                "login": LOGIN,
                "login_version": 5,
                "login_generation": 1,
                "login_state": "ready",
            },
        )

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login/failure",
            json={"version": 3, "generation": 1, "reason": "refresh_rejected"},
        )

        body = response.json()
        assert body["stale"] is True
        assert body["version"] == 5
        assert body["login"]["refresh"] == "refresh-1"

        read_back = harness.client.get(f"/secrets/{secret_id}").json()
        assert read_back["data"]["login_state"] == "ready"


class TestTheRunnerRoutesRefuseAnEditor:
    """Only the run's own credential may call the two login-upkeep routes.

    Both answer a stale call with the stored login in plaintext, which is the value every
    ordinary vault read redacts. RUN_SESSIONS plus USE_MOUNTS is a pair an editor holds, so
    permissions alone would hand that editor the ChatGPT access and refresh tokens. The
    `secret-resolve` grant rides only the Secret token a run is dispatched with.
    """

    def test_a_push_without_the_runtime_grant_is_403_and_writes_nothing(self, harness):
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )
        harness.as_an_editor()
        harness.asked.clear()

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
            json={
                "login": {**LOGIN, "refresh": "refresh-2", "expires": _expires_in(2)},
                "version": 3,
                "generation": 1,
            },
        )

        assert response.status_code == 403
        assert LOGIN["access"] not in response.text
        assert LOGIN["refresh"] not in response.text
        assert harness.asked == []

        read_back = harness.client.get(f"/secrets/{secret_id}").json()
        assert read_back["data"]["login_version"] == 3

    def test_a_stale_push_never_hands_an_editor_the_stored_login(self, harness):
        """The disclosure path itself: an old generation, which answers `stale` with it."""
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 3, "login_generation": 4},
        )
        harness.as_an_editor()

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
            json={
                "login": {**LOGIN, "refresh": "refresh-old", "expires": _expires_in(9)},
                "version": 0,
                "generation": 0,
            },
        )

        assert response.status_code == 403
        assert LOGIN["access"] not in response.text
        assert LOGIN["refresh"] not in response.text

    def test_a_failure_report_without_the_runtime_grant_is_403(self, harness):
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )
        harness.as_an_editor()
        harness.asked.clear()

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login/failure",
            json={"version": 3, "generation": 1, "reason": "unauthorized"},
        )

        assert response.status_code == 403
        assert harness.asked == []

        read_back = harness.client.get(f"/secrets/{secret_id}").json()
        assert read_back["data"]["login_state"] == "ready"

    def test_a_stale_failure_report_never_hands_an_editor_the_stored_login(
        self, harness
    ):
        """The reported P1: version 0 and generation 0 make every report stale."""
        secret_id = _signed_in(
            harness,
            {"login": LOGIN, "login_version": 5, "login_generation": 1},
        )
        harness.as_an_editor()

        response = harness.client.post(
            f"/secrets/{secret_id}/subscription-login/failure",
            json={"version": 0, "generation": 0, "reason": "unauthorized"},
        )

        assert response.status_code == 403
        assert LOGIN["access"] not in response.text
        assert LOGIN["refresh"] not in response.text
        assert "login" not in response.json()

    def test_the_browser_routes_still_work_without_the_grant(self, harness):
        """The device login is the editor's own verb; the grant belongs to the run."""
        secret_id = _create(harness.client)["id"]
        harness.as_an_editor()
        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1",
            state="pending",
            user_code="ABCD-EFGH",
            verification_uri="https://example.test/device",
            expires_at=_later(),
        )

        response = harness.client.post(f"/secrets/{secret_id}/login-attempts")

        assert response.status_code == 200, response.text
        assert response.json()["user_code"] == "ABCD-EFGH"


def _device_login(**overrides) -> dict:
    """A login shaped like the one the device flow hands back, with its own refresh token.

    A fresh token per call on purpose: the refresh token is what the store treats as the
    identity of a login, so reusing one turns a push into a no-op and hides a lost write.
    """
    return {
        **LOGIN,
        "refresh": f"refresh-{uuid4().hex}",
        "expires": _expires_in(1),
        **overrides,
    }


def _sign_in(harness):
    """Create a connection and carry it through a device login. Steps 1 to 4, compactly.

    Returns the connection id and the login the flow stored, so a caller can push against
    what the row actually holds instead of against a value it invented.
    """
    secret_id = _create(harness.client)["id"]

    harness.runner.next_attempt = RunnerLoginAttempt(
        attempt_id="att-lifecycle",
        state="pending",
        user_code="WXYZ-1234",
        expires_at=_later(),
    )
    started = harness.client.post(f"/secrets/{secret_id}/login-attempts")
    assert started.status_code == 200, started.text
    attempt_id = started.json()["attempt_id"]

    login = _device_login()
    reported = harness.client.post(
        _outcome_url(attempt_id),
        headers=RUNNER_HEADERS,
        json={
            "project_id": PROJECT_ID,
            "secret_id": secret_id,
            "state": "succeeded",
            "login": login,
        },
    )
    assert reported.status_code == 204, reported.text
    finished = harness.client.get(f"/secrets/{secret_id}/login-attempts/{attempt_id}")
    assert finished.status_code == 200, finished.text
    assert finished.json()["state"] == "succeeded"

    return secret_id, login


class TestTheWholeLifecycle:
    """One connection walked end to end, each step against what the step before it left.

    The other classes above check each route on a row they fabricate. These walk the row
    forward: created, signed in, refreshed, failed, deleted. What they pin is the ORDER
    and the state carried between the steps, which is what survives no refactor by
    accident. Routes only; nothing here names a function inside the service.
    """

    def test_a_new_connection_signs_in_and_reads_back_ready_and_redacted(self, harness):
        # 1. A fresh connection holds no login at all.
        created = _create(harness.client)
        secret_id = created["id"]
        assert created["data"]["login_state"] == "pending_login"

        # 2. Starting the device login hands the browser a code to type at the provider.
        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-lifecycle",
            state="pending",
            user_code="WXYZ-1234",
            verification_uri="https://example.test/device",
            expires_at=_later(),
            poll_after_ms=5000,
        )
        started = harness.client.post(f"/secrets/{secret_id}/login-attempts")
        assert started.status_code == 200, started.text
        attempt_id = started.json()["attempt_id"]
        user_code = started.json()["user_code"]
        assert started.json()["state"] == "pending"
        assert user_code

        # 3. The user is still at the provider, so the poll answers from the record alone.
        pending = harness.client.get(
            f"/secrets/{secret_id}/login-attempts/{attempt_id}"
        )

        assert pending.status_code == 200, pending.text
        assert pending.json()["state"] == "pending"
        assert pending.json()["user_code"] == user_code

        # ... and the row took nothing from an attempt that has not finished.
        waiting = harness.client.get(f"/secrets/{secret_id}").json()
        assert waiting["data"]["login_state"] == "pending_login"
        assert waiting["data"]["login_version"] == 0

        # 4. The runner pod reports the login, and the next poll finds it done.
        login = _device_login()
        reported = harness.client.post(
            _outcome_url(attempt_id),
            headers=RUNNER_HEADERS,
            json={
                "project_id": PROJECT_ID,
                "secret_id": secret_id,
                "state": "succeeded",
                "login": login,
            },
        )
        assert reported.status_code == 204, reported.text
        assert login["access"] not in reported.text

        finished = harness.client.get(
            f"/secrets/{secret_id}/login-attempts/{attempt_id}"
        )

        assert finished.status_code == 200, finished.text
        assert finished.json()["state"] == "succeeded"
        assert "login" not in finished.json()
        assert login["access"] not in finished.text
        assert login["refresh"] not in finished.text
        # The pod dropped the login once its report landed; nothing is sent back to it.
        assert harness.runner.deleted == []

        # 5. What the browser may see of a connection that now holds a credential.
        read_back = harness.client.get(f"/secrets/{secret_id}")

        assert read_back.status_code == 200, read_back.text
        data = read_back.json()["data"]
        assert data["login_state"] == "ready"
        assert data["login_version"] == 1
        assert data["login_generation"] == 1
        assert "login" not in data
        assert "login_attempt" not in data
        assert login["access"] not in read_back.text
        assert login["refresh"] not in read_back.text
        assert data["model_keys"]
        assert all(
            key.startswith(f"{data['provider_slug']}/") for key in data["model_keys"]
        )

    def test_a_signed_in_connection_takes_a_refresh_and_refuses_a_broken_one(
        self, harness
    ):
        secret_id, _ = _sign_in(harness)

        # 6. A run refreshed the login mid-turn and pushes it back on the lineage it was
        # handed by the device login above.
        refreshed = _device_login(expires=_expires_in(4))
        accepted = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
            json={"login": refreshed, "version": 1, "generation": 1},
        )

        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["updated"] is True
        assert accepted.json()["version"] == 2
        assert accepted.json()["generation"] == 1

        # 7. A later run whose own refresh went wrong pushes what it wrote instead.
        broken = harness.client.post(
            f"/secrets/{secret_id}/subscription-login",
            json={
                "login": _device_login(access="not-a-jwt", expires=_expires_in(9)),
                "version": 2,
                "generation": 1,
            },
        )

        assert broken.status_code == 200, broken.text
        assert broken.json()["updated"] is False
        assert broken.json()["reason"]
        assert broken.json()["version"] == 2

        after = harness.client.get(f"/secrets/{secret_id}").json()["data"]
        assert after["login_version"] == 2
        assert after["login_state"] == "ready"

    def test_a_stale_failure_leaves_it_ready_and_a_current_one_ends_it(self, harness):
        secret_id, _ = _sign_in(harness)
        refreshed = _device_login(expires=_expires_in(4))
        assert (
            harness.client.post(
                f"/secrets/{secret_id}/subscription-login",
                json={"login": refreshed, "version": 1, "generation": 1},
            ).json()["version"]
            == 2
        )

        # 8. A run that started before that refresh reports its older login as dead.
        stale = harness.client.post(
            f"/secrets/{secret_id}/subscription-login/failure",
            json={"version": 1, "generation": 1, "reason": "refresh_rejected"},
        )

        assert stale.status_code == 200, stale.text
        assert stale.json()["stale"] is True
        assert stale.json()["version"] == 2
        # It gets the current login back, so it can retry the turn in one hop.
        assert stale.json()["login"]["refresh"] == refreshed["refresh"]
        assert (
            harness.client.get(f"/secrets/{secret_id}").json()["data"]["login_state"]
            == "ready"
        )

        # 9. It rematerializes, retries on the current login, and that one really is dead.
        dead = harness.client.post(
            f"/secrets/{secret_id}/subscription-login/failure",
            json={"version": 2, "generation": 1, "reason": "refresh_rejected"},
        )

        assert dead.status_code == 200, dead.text
        assert dead.json()["stale"] is False
        assert (
            harness.client.get(f"/secrets/{secret_id}").json()["data"]["login_state"]
            == "needs_login"
        )

    def test_a_deleted_connection_is_gone_for_reads_and_for_new_logins(self, harness):
        secret_id, _ = _sign_in(harness)

        # 10. Disconnecting takes the row and everything hanging off it.
        deleted = harness.client.delete(f"/secrets/{secret_id}")

        assert deleted.status_code == 204

        assert harness.client.get(f"/secrets/{secret_id}").status_code == 404

        harness.runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-after-delete", state="pending", expires_at=_later()
        )
        assert (
            harness.client.post(f"/secrets/{secret_id}/login-attempts").status_code
            == 404
        )
