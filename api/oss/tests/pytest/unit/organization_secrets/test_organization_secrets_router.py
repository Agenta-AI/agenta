"""`/organization-secrets/` routes (M5, Task 7).

The real router, the real `VaultService` over an in-memory DAO and the recording cache
engine; the organization decision runs for real over a fake memberships service, with the
request access set the way the auth middleware sets it.
"""

import logging
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import oss.src.core.access.organizations as organizations_module
import oss.src.core.secrets.services as services_module
from oss.src.apis.fastapi.organization_secrets.router import (
    DENIED_MESSAGE,
    OrganizationSecretsRouter,
)
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.memberships.dtos import OrganizationMember
from oss.src.core.secrets.dtos import CreateSecretDTO, SecretOwner
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.core.secrets.limits import NoProjectLimits
from oss.src.core.secrets.services import VaultService
from oss.tests.pytest.utils.organization_secrets import (
    SENTINEL_KEY,
    InMemorySecretsDAO,
    install_cache_engine,
    org_secret_payload,
)
from oss.tests.pytest.utils.principals import make_envelope, make_request_access


class _AllowLimits:
    async def allows_selected_projects(self, *, organization_id):
        return True


class _Memberships:
    def __init__(self):
        self.roles = {}
        self.calls = 0

    async def fetch_organization_member(self, *, organization_id, user_id):
        self.calls += 1
        role = self.roles.get((organization_id, user_id))
        return (
            OrganizationMember(
                organization_id=organization_id, user_id=user_id, role=role
            )
            if role
            else None
        )


@pytest.fixture
def world(monkeypatch):
    install_cache_engine(monkeypatch)

    async def no_publish(**kwargs):
        return None

    monkeypatch.setattr(services_module, "_safe_publish", no_publish)
    memberships = _Memberships()
    monkeypatch.setattr(
        organizations_module, "get_memberships_service", lambda: memberships
    )
    organization_id, other_organization = uuid4(), uuid4()
    sales, marketing, foreign = uuid4(), uuid4(), uuid4()
    dao = InMemorySecretsDAO(
        projects={
            sales: organization_id,
            marketing: organization_id,
            foreign: other_organization,
        }
    )
    owner, admin, editor = uuid4(), uuid4(), uuid4()
    for user, role in ((owner, "owner"), (admin, "admin"), (editor, "editor")):
        memberships.roles[(organization_id, user)] = role
    state = {
        "user": owner,
        "credential": "bearer_session",
        "organization": organization_id,
    }

    def client(limits=None):
        vault = VaultService(dao, project_limits=limits)
        router = OrganizationSecretsRouter(vault_service=vault)
        app = FastAPI()

        @app.middleware("http")
        async def principal(request, call_next):
            request.state.user_id = str(state["user"])
            request.state.organization_id = str(state["organization"])
            request.state.project_id = str(sales)
            access = make_request_access(
                envelope=make_envelope(kind="human", principal_id=state["user"]),
                credential_kind=state["credential"],
            )
            token = set_request_access(access)
            try:
                return await call_next(request)
            finally:
                reset_request_access(token)

        app.include_router(router.router)
        return TestClient(app, raise_server_exceptions=False), vault

    return dict(
        client=client,
        dao=dao,
        memberships=memberships,
        state=state,
        organization_id=organization_id,
        other_organization=other_organization,
        sales=sales,
        marketing=marketing,
        foreign=foreign,
        owner=owner,
        admin=admin,
        editor=editor,
    )


def _routes(secret_id):
    return [
        ("post", "/organization-secrets/", org_secret_payload(slug="x")),
        ("get", "/organization-secrets/", None),
        ("get", f"/organization-secrets/{secret_id}", None),
        ("put", f"/organization-secrets/{secret_id}", {"header": {"name": "y"}}),
        ("delete", f"/organization-secrets/{secret_id}", None),
        (
            "put",
            f"/organization-secrets/{secret_id}/projects",
            {"availability": "all_projects", "project_ids": []},
        ),
    ]


def _call(client, method, path, body):
    return (
        getattr(client, method)(path, json=body)
        if body is not None
        else getattr(client, method)(path)
    )


def test_every_route_calls_the_organization_decision_first(world):
    client, _ = world["client"]()
    for user, credential in (
        (world["editor"], "bearer_session"),
        (uuid4(), "bearer_session"),
        (world["owner"], "api_key"),
        (world["owner"], "run_credential"),
    ):
        world["state"].update(user=user, credential=credential)
        for method, path, body in _routes(uuid4()):
            response = _call(client, method, path, body)
            assert response.status_code == 403, (method, path, credential)
            assert response.json() == {"detail": DENIED_MESSAGE}
    assert world["dao"].calls == []


@pytest.mark.parametrize("who", ["owner", "admin"])
def test_create_returns_no_value_and_the_organization_owner(world, who):
    world["state"]["user"] = world[who]
    client, _ = world["client"]()
    response = client.post(
        "/organization-secrets/", json=org_secret_payload(slug="openai-company")
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["owner"] == {
        "kind": "organization",
        "id": str(world["organization_id"]),
    }
    assert body["availability"] == "all_projects"
    assert body["write_only"] is True
    assert body["value_status"] == {"configured": True}
    assert SENTINEL_KEY not in response.text


def test_list_has_count_and_secrets_and_no_sso_rows(world):
    client, _ = world["client"]()
    client.post("/organization-secrets/", json=org_secret_payload(slug="a"))
    world["dao"]._store(
        world["dao"]._build(
            owner=SecretOwner(
                kind=SecretOwnerKind.ORGANIZATION, id=world["organization_id"]
            ),
            dto=CreateSecretDTO.model_validate(
                {
                    "header": {"name": "SSO"},
                    "secret": {
                        "kind": "sso_provider",
                        "data": {
                            "provider": {
                                "client_id": "c",
                                "client_secret": SENTINEL_KEY,
                                "issuer_url": "https://idp.example.com",
                                "scopes": ["openid"],
                            }
                        },
                    },
                }
            ),
        )
    )
    response = client.get("/organization-secrets/")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1 and [s["slug"] for s in body["secrets"]] == ["a"]
    assert SENTINEL_KEY not in response.text


def test_unknown_or_foreign_organization_id_answers_404(world):
    client, _ = world["client"]()
    foreign = world["dao"]._store(
        world["dao"]._build(
            owner=SecretOwner(
                kind=SecretOwnerKind.ORGANIZATION, id=world["other_organization"]
            ),
            dto=CreateSecretDTO.model_validate(org_secret_payload(slug="foreign")),
        )
    )
    project_row = world["dao"]._store(
        world["dao"]._build(
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=world["sales"]),
            dto=CreateSecretDTO.model_validate(org_secret_payload(slug="project")),
        )
    )
    for secret_id in (uuid4(), foreign.id, project_row.id):
        for method, path, body in _routes(secret_id)[2:]:
            assert _call(client, method, path, body).status_code == 404, (
                path,
                secret_id,
            )
    assert foreign.id in world["dao"].records and project_row.id in world["dao"].records


def test_sso_id_answers_404_on_all_six_routes_and_stays(world):
    client, _ = world["client"]()
    sso = world["dao"]._store(
        world["dao"]._build(
            owner=SecretOwner(
                kind=SecretOwnerKind.ORGANIZATION, id=world["organization_id"]
            ),
            dto=CreateSecretDTO.model_validate(
                {
                    "header": {"name": "SSO"},
                    "secret": {
                        "kind": "sso_provider",
                        "data": {
                            "provider": {
                                "client_id": "c",
                                "client_secret": SENTINEL_KEY,
                                "issuer_url": "https://idp.example.com",
                                "scopes": ["openid"],
                            }
                        },
                    },
                }
            ),
        )
    )
    before = sso.model_dump()
    for method, path, body in _routes(sso.id)[2:]:
        assert _call(client, method, path, body).status_code == 404, path
    listed = client.get("/organization-secrets/").json()
    assert all(s["id"] != str(sso.id) for s in listed["secrets"])
    # And the create route refuses the SSO kind.
    response = client.post(
        "/organization-secrets/",
        json={
            "header": {"name": "SSO"},
            "secret": {
                "kind": "sso_provider",
                "data": {
                    "provider": {
                        "client_id": "c",
                        "issuer_url": "https://idp.example.com",
                        "scopes": ["openid"],
                    }
                },
            },
        },
    )
    assert response.status_code == 422
    assert world["dao"].records[sso.id].model_dump() == before


def test_create_refused_by_a_limit_leaves_no_row(world):
    client, _ = world["client"](_AllowLimits())
    response = client.post(
        "/organization-secrets/",
        json={
            **org_secret_payload(slug="limited"),
            "availability": "selected_projects",
            "project_ids": [str(world["sales"]), str(world["foreign"])],
        },
    )
    assert response.status_code == 422
    assert (
        response.json()["detail"] == "Every project must belong to this organization."
    )
    assert world["dao"].records == {}


def test_kind_family_bedrock_refusals_answer_422(world):
    client, _ = world["client"]()
    for body in (
        {
            "header": {"name": "token"},
            "secret": {
                "kind": "custom_secret",
                "data": {"secret": {"format": "text", "content": "value-123456"}},
            },
        },
        org_secret_payload(family="composio"),
        org_secret_payload(kind="custom_provider", family="bedrock"),
        org_secret_payload(key="m5key12"),
        org_secret_payload(key="  m5key12  "),
    ):
        response = client.post("/organization-secrets/", json=body)
        assert response.status_code == 422, (body, response.text)
    assert world["dao"].records == {}


def test_duplicate_slug_and_shadow_conflict_answer_409(world):
    client, vault = world["client"]()
    assert (
        client.post(
            "/organization-secrets/", json=org_secret_payload(slug="dup")
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/organization-secrets/", json=org_secret_payload(slug="dup")
        ).status_code
        == 409
    )
    world["dao"]._store(
        world["dao"]._build(
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=world["marketing"]),
            dto=CreateSecretDTO.model_validate(
                org_secret_payload(slug="shadow", family="anthropic")
            ),
        )
    )
    response = client.post(
        "/organization-secrets/", json=org_secret_payload(slug="shadow")
    )
    assert response.status_code == 409
    assert "another kind or provider" in response.json()["detail"]


def test_projects_route_oss_403_ee_without_rbac_403_foreign_422(world):
    client, _ = world["client"](NoProjectLimits())
    created = client.post(
        "/organization-secrets/", json=org_secret_payload(slug="l")
    ).json()
    path = f"/organization-secrets/{created['id']}/projects"
    limited = {
        "availability": "selected_projects",
        "project_ids": [str(world["sales"])],
    }
    assert client.put(path, json=limited).status_code == 403
    client_ee, _ = world["client"](_AllowLimits())
    response = client_ee.put(path, json=limited)
    assert response.status_code == 200
    assert response.json()["selected_project_ids"] == [str(world["sales"])]
    response = client_ee.put(
        path,
        json={
            "availability": "selected_projects",
            "project_ids": [str(world["foreign"])],
        },
    )
    assert response.status_code == 422
    assert client_ee.get(f"/organization-secrets/{created['id']}").json()[
        "selected_project_ids"
    ] == [str(world["sales"])]


def test_validation_errors_never_echo_the_body(world):
    client, _ = world["client"]()
    response = client.post(
        "/organization-secrets/",
        json={
            "header": {"name": "x"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": [SENTINEL_KEY]}},
            },
        },
    )
    assert response.status_code == 422
    assert SENTINEL_KEY not in response.text


def test_logs_carry_no_value(world, caplog, capsys, monkeypatch):
    from oss.src.core.secrets.types import SecretStorageError

    client, _ = world["client"]()

    async def broken(**kwargs):
        try:
            raise RuntimeError(f"pgp_sym_encrypt('{SENTINEL_KEY}')")
        except RuntimeError:
            raise SecretStorageError() from None

    with caplog.at_level(logging.DEBUG):
        assert (
            client.post(
                "/organization-secrets/", json=org_secret_payload(slug="ok")
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/organization-secrets/", json=org_secret_payload(slug="ok")
            ).status_code
            == 409
        )
        assert (
            client.post(
                "/organization-secrets/", json=org_secret_payload(key=SENTINEL_KEY[:7])
            ).status_code
            == 422
        )
        world["state"]["user"] = world["editor"]
        assert (
            client.post(
                "/organization-secrets/", json=org_secret_payload(slug="x")
            ).status_code
            == 403
        )
        world["state"]["user"] = world["owner"]
        monkeypatch.setattr(world["dao"], "create_organization_secret", broken)
        response = client.post(
            "/organization-secrets/", json=org_secret_payload(slug="boom")
        )
    assert response.status_code == 500
    assert any("INTERCEPTED" in r.getMessage() for r in caplog.records)
    for record in caplog.records:
        assert SENTINEL_KEY not in record.getMessage()
        assert SENTINEL_KEY[:7] not in record.getMessage()
    captured = capsys.readouterr()
    assert SENTINEL_KEY not in captured.out + captured.err
