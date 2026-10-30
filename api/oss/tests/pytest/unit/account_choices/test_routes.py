"""`/account-choices` and `POST /secrets/resolve`: the checks and the shapes."""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import oss.src.apis.fastapi.account_choices.router as choices_router_module
import oss.src.apis.fastapi.vault.router as vault_router_module
import oss.src.core.account_choices.policy as policy_module
from oss.src.apis.fastapi.account_choices.router import AccountChoicesRouter
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.account_choices.claims import run_accounts_from_claim
from oss.src.core.account_choices.dtos import AccountChoice, ItemAccount
from oss.src.core.account_choices.exceptions import AccountNotYours
from oss.src.core.secrets.claude_token import ClaudeTokenClient
from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import SubscriptionLoginRunnerClient
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT
from oss.tests.pytest.utils.organization_secrets import (
    InMemorySecretsDAO,
    install_cache_engine,
)
from oss.tests.pytest.utils.principals import make_envelope, make_request_access

TOKEN_KEY = "secret:user/GITHUB_TOKEN"


@pytest.fixture
def state(monkeypatch):
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_accounts_enabled", True
    )
    organization_id, project_id, person = uuid4(), uuid4(), uuid4()
    return {
        "organization": organization_id,
        "project": project_id,
        "person": person,
        "kind": "human",
        "credential": "bearer_session",
        "run_accounts": (),
        "allowed": True,
    }


def _app(state, router) -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def principal(request, call_next):
        request.state.user_id = str(state["person"])
        request.state.organization_id = str(state["organization"])
        request.state.project_id = str(state["project"])
        if state["credential"] == "run_credential":
            request.state.token_grants = (SECRET_RESOLVE_GRANT,)
        envelope = make_envelope(
            kind=state["kind"],
            principal_id=state["person"],
            organization_id=state["organization"],
            project_id=state["project"],
        )
        access = make_request_access(
            envelope=envelope, credential_kind=state["credential"]
        ).model_copy(update={"run_accounts": state["run_accounts"]})
        token = set_request_access(access)
        try:
            return await call_next(request)
        finally:
            reset_request_access(token)

    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False)


class _Choices:
    def __init__(self):
        self.calls = []

    async def upsert(self, **kwargs):
        self.calls.append(("upsert", kwargs))
        if kwargs["choice"].secret_id == NOT_MINE:
            raise AccountNotYours()
        return AccountChoice(
            id=uuid4(),
            workflow_id=kwargs["choice"].workflow_id,
            item_key=kwargs["choice"].item_key,
            secret_id=kwargs["choice"].secret_id,
        )

    async def resolve(self, **kwargs):
        self.calls.append(("resolve", kwargs))
        return [ItemAccount(item_key=item.item_key) for item in kwargs["items"]]

    async def query(self, **kwargs):
        self.calls.append(("query", kwargs))
        return []


NOT_MINE = uuid4()


@pytest.fixture
def choices_client(state, monkeypatch):
    async def access(**kwargs):
        return state["allowed"]

    async def agent(*args, **kwargs):
        return state["allowed"]

    monkeypatch.setattr(choices_router_module, "check_action_access", access)
    monkeypatch.setattr(choices_router_module, "allow_agent", agent)
    service = _Choices()
    router = AccountChoicesRouter(
        account_choices_service=service, workflows_service=None
    )
    return _app(state, router.router), service


def test_upsert_stores_the_callers_choice(state, choices_client):
    client, service = choices_client
    workflow_id, secret_id = uuid4(), uuid4()
    response = client.post(
        "/",
        json={
            "account_choice": {
                "workflow_id": str(workflow_id),
                "item_key": TOKEN_KEY,
                "secret_id": str(secret_id),
            }
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["account_choice"]["workflow_id"] == str(workflow_id)
    ((_, call),) = service.calls
    assert call["user_id"] == state["person"]


def test_upsert_errors_carry_codes(state, choices_client):
    client, _ = choices_client
    body = {
        "account_choice": {
            "workflow_id": str(uuid4()),
            "item_key": TOKEN_KEY,
            "secret_id": str(NOT_MINE),
        }
    }
    response = client.post("/", json=body)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "account_not_yours"

    state["allowed"] = False
    response = client.post("/", json=body)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"

    bad = {"account_choice": {**body["account_choice"], "item_key": "secret:GITHUB"}}
    assert client.post("/", json=bad).status_code == 422


def test_resolve_reads_a_draft_configuration(state, choices_client):
    client, service = choices_client
    parameters = {
        "agent": {
            "sandbox": {
                "credentials": [
                    {
                        "secret": {"account_source": "user"},
                        "binding": {"type": "env", "name": "GITHUB_TOKEN"},
                    }
                ]
            }
        }
    }
    response = client.post(
        "/resolve", json={"workflow_id": str(uuid4()), "parameters": parameters}
    )
    assert response.status_code == 200, response.text
    assert response.json()["item_accounts"] == [
        {"item_key": TOKEN_KEY, "is_ready": False, "candidates": 0}
    ]
    both = client.post(
        "/resolve",
        json={
            "workflow_id": str(uuid4()),
            "parameters": parameters,
            "workflow_revision_ref": {"id": str(uuid4())},
        },
    )
    assert both.status_code == 422


@pytest.mark.parametrize(
    "kind,credential", [("api_key", "api_key"), ("human", "run_credential")]
)
def test_only_a_signed_in_person(state, choices_client, kind, credential):
    client, _ = choices_client
    state["kind"], state["credential"] = kind, credential
    response = client.post("/query", json={})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "user_required"


def test_the_switch_off_closes_every_route(state, choices_client, monkeypatch):
    client, _ = choices_client
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_accounts_enabled", False
    )
    for method, path in (
        ("post", "/query"),
        ("get", f"/{uuid4()}"),
        ("delete", f"/{uuid4()}"),
    ):
        kwargs = {"json": {}} if method == "post" else {}
        response = getattr(client, method)(path, **kwargs)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "personal_accounts_disabled"


@pytest.fixture
def vault_world(state, monkeypatch):
    install_cache_engine(monkeypatch)

    async def allow(**kwargs):
        return state["allowed"]

    monkeypatch.setattr(vault_router_module, "check_action_access", allow)
    dao = InMemorySecretsDAO(projects={state["project"]: state["organization"]})
    vault = VaultService(dao)
    router = VaultRouter(
        vault_service=vault,
        subscription_login_service=SubscriptionLoginService(
            vault_service=vault,
            runner_client=SubscriptionLoginRunnerClient(base_url="", token=""),
            claude_token_client=ClaudeTokenClient(),
        ),
    )
    return _app(state, router.router), vault, dao


async def test_secrets_resolve_returns_only_the_claims_secrets(state, vault_world):
    client, vault, dao = vault_world
    secret = await vault.create_personal_secret(
        organization_id=state["organization"],
        user_id=state["person"],
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": "GitHub"},
                "secret": {
                    "kind": "custom_secret",
                    "data": {"secret": {"format": "text", "content": "ghp-value"}},
                },
            }
        ),
    )
    keys = {"item_keys": [TOKEN_KEY, "secret:user/OTHER", "app_connection:user/gmail"]}

    # A session is not a run.
    assert client.post("/secrets/resolve", json=keys).status_code == 403

    state["credential"] = "run_credential"
    assert client.post("/secrets/resolve", json=keys).json() == {
        "count": 0,
        "item_secrets": [],
    }

    state["run_accounts"] = run_accounts_from_claim(
        [{"item_key": TOKEN_KEY, "secret_id": str(secret.id)}]
    )
    dao.calls.clear()
    body = client.post("/secrets/resolve", json=keys).json()
    assert body["count"] == 1
    assert body["item_secrets"][0]["item_key"] == TOKEN_KEY
    assert body["item_secrets"][0]["secret"]["data"]["secret"]["content"] == "ghp-value"
    assert dao.calls == ["list_by_ids"]

    # Another person's run never reads it, even with the same claim.
    state["person"] = uuid4()
    assert client.post("/secrets/resolve", json=keys).json()["count"] == 0


async def test_secrets_resolve_serves_two_items_on_one_secret_and_needs_view_secret(
    state, vault_world
):
    client, vault, _ = vault_world
    secret = await vault.create_personal_secret(
        organization_id=state["organization"],
        user_id=state["person"],
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": "GitHub"},
                "secret": {
                    "kind": "custom_secret",
                    "data": {"secret": {"format": "text", "content": "ghp-value"}},
                },
            }
        ),
    )
    other_key = "secret:user/GH_TOKEN"
    state["credential"] = "run_credential"
    state["run_accounts"] = run_accounts_from_claim(
        [
            {"item_key": TOKEN_KEY, "secret_id": str(secret.id)},
            {"item_key": other_key, "secret_id": str(secret.id)},
        ]
    )
    body = client.post(
        "/secrets/resolve", json={"item_keys": [TOKEN_KEY, other_key]}
    ).json()
    assert sorted(item["item_key"] for item in body["item_secrets"]) == sorted(
        [TOKEN_KEY, other_key]
    )

    state["allowed"] = False
    response = client.post("/secrets/resolve", json={"item_keys": [TOKEN_KEY]})
    assert response.status_code == 403
