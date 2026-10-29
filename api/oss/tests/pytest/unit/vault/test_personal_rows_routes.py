"""The `/secrets/` routes on a person's own rows (`scope=user`).

The real router and the real `VaultService` over the in-memory DAO, with the request
access set the way the auth middleware sets it.
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import oss.src.apis.fastapi.vault.router as vault_router_module
import oss.src.core.account_choices.policy as policy_module
import oss.src.core.secrets.services as services_module
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.secrets.claude_token import ClaudeTokenClient
from oss.src.core.secrets.dtos import CreateSecretDTO, SecretOwner
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import SubscriptionLoginRunnerClient
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.tests.pytest.utils.organization_secrets import (
    InMemorySecretsDAO,
    install_cache_engine,
)
from oss.tests.pytest.utils.principals import make_envelope, make_request_access

VALUE = "ghp-personal-value-123456"
TOKEN_SLUG = "mcp-token-0123456789ab"


def _custom(name="GitHub token", content=VALUE, slug=None):
    body = {
        "header": {"name": name},
        "secret": {
            "kind": "custom_secret",
            "data": {"secret": {"format": "text", "content": content}},
        },
        "scope": "user",
    }
    if slug:
        body["slug"] = slug
    return body


def _token(content):
    return CreateSecretDTO.model_validate(
        {
            "slug": TOKEN_SLUG,
            "header": {"name": "Linear"},
            "secret": {
                "kind": "mcp_token",
                "data": {"secret": {"format": "text", "content": content}},
            },
        }
    )


@pytest.fixture
def world(monkeypatch):
    install_cache_engine(monkeypatch)
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_accounts_enabled", True
    )

    async def project_access(**kwargs):
        return True

    monkeypatch.setattr(vault_router_module, "check_action_access", project_access)

    async def no_publish(**kwargs):
        return None

    monkeypatch.setattr(services_module, "_safe_publish", no_publish)

    organization_id, project_id = uuid4(), uuid4()
    dao = InMemorySecretsDAO(projects={project_id: organization_id})
    state = {"user": uuid4(), "kind": "human", "credential": "bearer_session"}
    vault = VaultService(dao)
    router = VaultRouter(
        vault_service=vault,
        subscription_login_service=SubscriptionLoginService(
            vault_service=vault,
            runner_client=SubscriptionLoginRunnerClient(base_url="", token=""),
            claude_token_client=ClaudeTokenClient(),
        ),
    )
    app = FastAPI()

    @app.middleware("http")
    async def principal(request, call_next):
        request.state.user_id = str(state["user"])
        request.state.organization_id = str(organization_id)
        request.state.project_id = str(project_id)
        access = make_request_access(
            envelope=make_envelope(kind=state["kind"], principal_id=state["user"]),
            credential_kind=state["credential"],
        )
        token = set_request_access(access)
        try:
            return await call_next(request)
        finally:
            reset_request_access(token)

    app.include_router(router.router)
    return dict(
        client=TestClient(app, raise_server_exceptions=False),
        dao=dao,
        vault=vault,
        state=state,
        organization_id=organization_id,
        project_id=project_id,
    )


def test_a_person_creates_lists_reads_edits_and_deletes_their_own_secret(world):
    client = world["client"]
    created = client.post("/secrets/", json=_custom(slug="github"))
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["owner"]["kind"] == "user"
    assert body["owner"]["id"] == str(world["state"]["user"])
    assert VALUE not in created.text

    listed = client.get("/secrets/?scope=user").json()
    assert [row["id"] for row in listed] == [body["id"]]
    # A person's row is never a project row.
    assert client.get("/secrets/").json() == []

    by_slug = client.get("/secrets/github?scope=user")
    assert by_slug.status_code == 200 and by_slug.json()["id"] == body["id"]

    edited = client.put(
        f"/secrets/{body['id']}?scope=user", json={"header": {"name": "Renamed"}}
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["header"]["name"] == "Renamed"

    assert client.delete(f"/secrets/{body['id']}?scope=user").status_code == 204
    assert client.get("/secrets/?scope=user").json() == []


def test_another_person_never_sees_or_changes_the_row(world):
    client = world["client"]
    created = client.post("/secrets/", json=_custom()).json()
    world["state"]["user"] = uuid4()

    assert client.get("/secrets/?scope=user").json() == []
    assert client.get(f"/secrets/{created['id']}?scope=user").status_code == 404
    renamed = client.put(
        f"/secrets/{created['id']}?scope=user", json={"header": {"name": "x"}}
    )
    assert renamed.status_code == 404
    client.delete(f"/secrets/{created['id']}?scope=user")
    assert created["id"] in {str(key) for key in world["dao"].records}


def test_only_custom_secrets_are_personal(world):
    response = world["client"].post(
        "/secrets/",
        json={
            "header": {"name": "OpenAI"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "sk-" + "x" * 30}},
            },
            "scope": "user",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "kind_not_supported"
    assert world["dao"].records == {}


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "/secrets/", _custom()),
        ("get", "/secrets/?scope=user", None),
        ("get", "/secrets/github?scope=user", None),
        ("put", f"/secrets/{uuid4()}?scope=user", {"header": {"name": "x"}}),
        ("delete", f"/secrets/{uuid4()}?scope=user", None),
    ],
)
def test_every_person_route_is_off_with_the_switch(
    world, monkeypatch, method, path, body
):
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_accounts_enabled", False
    )
    kwargs = {"json": body} if body is not None else {}
    response = getattr(world["client"], method)(path, **kwargs)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "personal_accounts_disabled"


@pytest.mark.parametrize(
    "kind,credential", [("api_key", "api_key"), ("human", "run_credential")]
)
def test_only_the_person_signed_in_reaches_person_routes(world, kind, credential):
    world["state"]["kind"] = kind
    world["state"]["credential"] = credential
    response = world["client"].get("/secrets/?scope=user")
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "user_required"


async def test_sign_ins_are_never_listed_or_read_through_the_vault(world):
    row = await world["vault"].put_personal_secret(
        organization_id=world["organization_id"],
        user_id=world["state"]["user"],
        create_secret_dto=_token("tok-1"),
    )
    assert row.kind == SecretKind.MCP_TOKEN and row.write_only is True
    client = world["client"]
    assert client.get("/secrets/?scope=user").json() == []
    assert client.get(f"/secrets/{row.id}?scope=user").status_code == 404


async def test_put_personal_secret_replaces_in_place_and_keeps_the_id(world):
    vault, person = world["vault"], world["state"]["user"]
    organization_id = world["organization_id"]

    first = await vault.put_personal_secret(
        organization_id=organization_id,
        user_id=person,
        create_secret_dto=_token("tok-1"),
    )
    second = await vault.put_personal_secret(
        organization_id=organization_id,
        user_id=person,
        create_secret_dto=_token("tok-2"),
    )
    assert second.id == first.id
    assert second.data.secret.content == "tok-2"

    listed = await vault.list_personal_sign_ins(
        organization_id=organization_id, user_id=person, slugs=[TOKEN_SLUG, "other"]
    )
    assert [row.id for row in listed] == [first.id]
    assert listed[0].owner == SecretOwner.for_user(
        organization_id=organization_id, user_id=person
    )

    deleted = await vault.delete_sign_ins(
        organization_id=organization_id,
        project_id=world["project_id"],
        slugs=[TOKEN_SLUG],
    )
    assert deleted == 1
    assert world["dao"].records == {}
