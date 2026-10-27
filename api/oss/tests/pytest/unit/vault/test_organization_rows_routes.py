"""The `/secrets/` routes on organization rows (M5).

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
import oss.src.apis.fastapi.vault.router as vault_router_module
from oss.src.apis.fastapi.vault.router import (
    ORGANIZATION_DENIED_MESSAGE,
    PROJECT_DENIED_MESSAGE,
    VaultRouter,
)
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.memberships.dtos import OrganizationMember
from oss.src.core.secrets.dtos import CreateSecretDTO, SecretOwner
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.core.secrets.limits import NoProjectLimits
from oss.src.core.secrets.claude_token import ClaudeTokenClient
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import (
    RunnerLoginAttempt,
    SubscriptionLoginRunnerClient,
)
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
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
        "project_access": True,
    }

    async def project_access(**kwargs):
        return state["project_access"]

    monkeypatch.setattr(vault_router_module, "check_action_access", project_access)

    def client(limits=None, runner=None):
        vault = VaultService(dao, project_limits=limits)
        router = VaultRouter(
            vault_service=vault,
            subscription_login_service=SubscriptionLoginService(
                vault_service=vault,
                runner_client=runner
                or SubscriptionLoginRunnerClient(base_url="", token=""),
                claude_token_client=ClaudeTokenClient(),
            ),
        )
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


def _create(client, body):
    return client.post("/secrets/", json={**body, "scope": "organization"})


def _routes(secret_id):
    return [
        (
            "post",
            "/secrets/",
            {**org_secret_payload(slug="x"), "scope": "organization"},
        ),
        ("get", "/secrets/?scope=organization", None),
        ("get", f"/secrets/{secret_id}", None),
        ("put", f"/secrets/{secret_id}", {"header": {"name": "y"}}),
        ("delete", f"/secrets/{secret_id}", None),
        (
            "put",
            f"/secrets/{secret_id}/projects",
            {"availability": "all_projects", "project_ids": []},
        ),
        (
            "put",
            f"/secrets/{secret_id}/subscription-token",
            {"token": "sk-ant-oat01-" + "x" * 40},
        ),
        ("post", f"/secrets/{secret_id}/login-attempts", None),
        ("get", f"/secrets/{secret_id}/login-attempts/att-1", None),
        (
            "post",
            f"/secrets/{secret_id}/login-attempts/att-1/cancel",
            None,
        ),
    ]


def _call(client, method, path, body):
    return (
        getattr(client, method)(path, json=body)
        if body is not None
        else getattr(client, method)(path)
    )


def test_a_caller_who_manages_neither_owner_gets_403_and_reads_nothing(world):
    client, _ = world["client"]()
    world["state"]["project_access"] = False
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
            # Create, list and projects name the organization; the rest find the row.
            organization_only = method == "post" and path == "/secrets/"
            organization_only |= path.endswith("?scope=organization")
            organization_only |= path.endswith("/projects")
            assert response.json() == {
                "detail": ORGANIZATION_DENIED_MESSAGE
                if organization_only
                else PROJECT_DENIED_MESSAGE
            }, (method, path)
    assert world["dao"].calls == []


@pytest.mark.parametrize("who", ["owner", "admin"])
def test_create_returns_no_value_and_the_organization_owner(world, who):
    world["state"]["user"] = world[who]
    client, _ = world["client"]()
    response = _create(client, org_secret_payload(slug="openai-company"))
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
    _create(client, org_secret_payload(slug="a"))
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
    response = client.get("/secrets/?scope=organization")
    assert response.status_code == 200
    body = response.json()
    assert [s["slug"] for s in body] == ["a"]
    assert SENTINEL_KEY not in response.text


def test_unknown_or_foreign_organization_id_answers_404_and_delete_204(world):
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
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=world["marketing"]),
            dto=CreateSecretDTO.model_validate(org_secret_payload(slug="project")),
        )
    )
    for secret_id in (uuid4(), foreign.id, project_row.id):
        for method, path, body in _routes(secret_id)[2:]:
            # A delete never tells whether a row exists elsewhere.
            expected = 204 if method == "delete" else 404
            assert _call(client, method, path, body).status_code == expected, (
                path,
                secret_id,
            )
    assert foreign.id in world["dao"].records and project_row.id in world["dao"].records


def test_an_sso_id_is_never_addressed_and_stays(world):
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
        expected = 204 if method == "delete" else 404
        assert _call(client, method, path, body).status_code == expected, path
    listed = client.get("/secrets/?scope=organization").json()
    assert all(s["id"] != str(sso.id) for s in listed)
    # And the create route refuses the SSO kind.
    response = _create(
        client,
        {
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
    response = _create(
        client,
        {
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
        response = _create(client, body)
        assert response.status_code == 422, (body, response.text)
    assert world["dao"].records == {}


def test_a_duplicate_organization_slug_answers_409_and_a_project_slug_does_not(world):
    client, vault = world["client"]()
    assert _create(client, org_secret_payload(slug="dup")).status_code == 200
    assert _create(client, org_secret_payload(slug="dup")).status_code == 409
    # A project row with the slug, of another family, is a separate connection.
    world["dao"]._store(
        world["dao"]._build(
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=world["marketing"]),
            dto=CreateSecretDTO.model_validate(
                org_secret_payload(slug="same-name", family="anthropic")
            ),
        )
    )
    response = _create(client, org_secret_payload(slug="same-name"))
    assert response.status_code == 200, response.text


def test_projects_route_oss_403_ee_without_rbac_403_foreign_422(world):
    client, _ = world["client"](NoProjectLimits())
    created = _create(client, org_secret_payload(slug="l")).json()
    path = f"/secrets/{created['id']}/projects"
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
    assert client_ee.get(f"/secrets/{created['id']}").json()[
        "selected_project_ids"
    ] == [str(world["sales"])]


def test_validation_errors_never_echo_the_body(world):
    client, _ = world["client"]()
    response = _create(
        client,
        {
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
        assert _create(client, org_secret_payload(slug="ok")).status_code == 200
        assert _create(client, org_secret_payload(slug="ok")).status_code == 409
        assert (
            _create(client, org_secret_payload(key=SENTINEL_KEY[:7])).status_code == 422
        )
        world["state"]["user"] = world["editor"]
        assert _create(client, org_secret_payload(slug="x")).status_code == 403
        world["state"]["user"] = world["owner"]
        monkeypatch.setattr(world["dao"], "create_organization_secret", broken)
        response = _create(client, org_secret_payload(slug="boom"))
    assert response.status_code == 500
    assert any("INTERCEPTED" in r.getMessage() for r in caplog.records)
    for record in caplog.records:
        assert SENTINEL_KEY not in record.getMessage()
        assert SENTINEL_KEY[:7] not in record.getMessage()
    captured = capsys.readouterr()
    assert SENTINEL_KEY not in captured.out + captured.err


def test_a_limit_on_an_unknown_sso_or_foreign_id_answers_404_before_403(world):
    client, _ = world["client"](NoProjectLimits())
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
    foreign = world["dao"]._store(
        world["dao"]._build(
            owner=SecretOwner(
                kind=SecretOwnerKind.ORGANIZATION, id=world["other_organization"]
            ),
            dto=CreateSecretDTO.model_validate(org_secret_payload(slug="foreign")),
        )
    )
    limited = {
        "availability": "selected_projects",
        "project_ids": [str(world["sales"])],
    }
    for secret_id in (uuid4(), sso.id, foreign.id):
        response = client.put(f"/secrets/{secret_id}/projects", json=limited)
        assert response.status_code == 404, (secret_id, response.text)
    own = _create(client, org_secret_payload(slug="own")).json()
    assert client.put(f"/secrets/{own['id']}/projects", json=limited).status_code == 403


class _FakeRunner:
    def __init__(self):
        self.started = []

    async def start_attempt(
        self, *, provider, project_id, secret_id, organization_id=None
    ):
        self.started.append(
            {
                "provider": provider,
                "project_id": project_id,
                "organization_id": organization_id,
                "secret_id": secret_id,
            }
        )
        from datetime import datetime, timedelta, timezone

        return RunnerLoginAttempt(
            attempt_id="att-org",
            state="pending",
            expires_at=(datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            user_code="ABCD-1234",
            verification_uri="https://auth.openai.com/codex/device",
        )

    async def delete_attempt(
        self, *, attempt_id, base_url=None, runner_replica_id=None
    ):
        return True


def test_an_admin_creates_an_organization_subscription_and_starts_its_login(world):
    """An organization subscription login (M5): created pending, named with its owner, and
    its device login reports to the organization row, never to a project."""
    runner = _FakeRunner()
    client, _ = world["client"](runner=runner)
    world["state"].update(user=world["admin"])
    created = _create(
        client,
        {
            "header": {"description": "shared"},
            "secret": {
                "kind": "subscription_provider",
                "data": {"provider": "chatgpt"},
            },
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["header"]["name"] == "ChatGPT (Organization)"
    assert body["owner"]["kind"] == "organization"
    assert body["data"]["login_state"] == "pending_login"

    started = client.post(f"/secrets/{body['id']}/login-attempts")
    assert started.status_code == 200, started.text
    assert started.json()["user_code"] == "ABCD-1234"
    assert runner.started == [
        {
            "provider": "chatgpt",
            "project_id": None,
            "organization_id": str(world["organization_id"]),
            "secret_id": body["id"],
        }
    ]

    polled = client.get(f"/secrets/{body['id']}/login-attempts/att-org")
    assert polled.status_code == 200, polled.text
    assert polled.json()["state"] == "pending"


def test_an_editor_cannot_create_an_organization_subscription(world):
    client, _ = world["client"](runner=_FakeRunner())
    world["state"].update(user=world["editor"])
    response = _create(
        client,
        {
            "header": {"name": "ChatGPT"},
            "secret": {
                "kind": "subscription_provider",
                "data": {"provider": "chatgpt"},
            },
        },
    )
    assert response.status_code == 403
    assert world["dao"].records == {}


def test_an_unnamed_organization_login_is_named_and_a_second_one_is_409(world):
    client, _ = world["client"](runner=_FakeRunner())
    login = {
        "header": {},
        "secret": {"kind": "subscription_provider", "data": {"provider": "chatgpt"}},
    }
    created = _create(client, login)
    assert created.status_code == 200, created.text
    assert created.json()["header"]["name"] == "ChatGPT (Organization)"

    again = _create(client, login)
    assert again.status_code == 409
    assert again.json()["detail"].startswith("This organization already has")

    # A project login still needs a name, as before.
    assert client.post("/secrets/", json=login).status_code == 422
