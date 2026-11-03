"""`GET /secrets/?include_organization=true` and the project routes against organization
rows (M5)."""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import oss.src.core.secrets.services as services_module
from oss.src.apis.fastapi.vault import router as router_module
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.secrets.claude_token import ClaudeTokenClient
from oss.src.core.secrets.dtos import CreateSecretDTO, SubscriptionLoginDTO
from oss.src.core.secrets.enums import SecretAvailability
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import SubscriptionLoginRunnerClient
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT
from oss.src.utils.env import env
from oss.tests.pytest.utils.organization_secrets import (
    SENTINEL_KEY,
    InMemorySecretsDAO,
    install_cache_engine,
    org_secret_payload,
)


@pytest.fixture
def world(monkeypatch):
    install_cache_engine(monkeypatch)

    async def allow(**kwargs):
        return True

    async def no_publish(**kwargs):
        return None

    monkeypatch.setattr(router_module, "check_action_access", allow)
    monkeypatch.setattr(env.llm_gateway, "enabled", True)
    monkeypatch.setattr(services_module, "_safe_publish", no_publish)
    organization_id = uuid4()
    sales, marketing = uuid4(), uuid4()
    dao = InMemorySecretsDAO(
        projects={sales: organization_id, marketing: organization_id}
    )
    vault = VaultService(dao)
    state = {"project": sales, "organization": organization_id}
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
        request.state.user_id = str(uuid4())
        request.state.project_id = str(state["project"])
        request.state.organization_id = str(state["organization"])
        if request.headers.get("x-test-grant"):
            request.state.token_grants = (SECRET_RESOLVE_GRANT,)
        return await call_next(request)

    app.include_router(router.router)
    return dict(
        client=TestClient(app, raise_server_exceptions=False),
        vault=vault,
        dao=dao,
        state=state,
        organization_id=organization_id,
        sales=sales,
        marketing=marketing,
    )


async def _org(world, **kwargs):
    return await world["vault"].create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(org_secret_payload(**kwargs)),
        user_id=uuid4(),
    )


async def test_list_without_the_parameter_is_todays_response_plus_owner(world):
    await _org(world, slug="openai-company")
    client = world["client"]
    created = client.post(
        "/secrets/", json=org_secret_payload(slug="mine", key="sk-proj-0123456789")
    )
    assert created.status_code == 200
    rows = client.get("/secrets/").json()
    assert [r["slug"] for r in rows] == ["mine"]
    assert rows[0]["owner"] == {"kind": "project", "id": str(world["sales"])}


async def test_include_organization_adds_organization_rows_without_values(world):
    company = await _org(world, slug="openai-company")
    client = world["client"]
    # A project row with the same slug is a separate connection; both are listed.
    own = client.post(
        "/secrets/",
        json=org_secret_payload(slug="openai-company", key="sk-proj-0123456789"),
    )
    assert own.status_code == 200
    response = client.get("/secrets/?include_organization=true")
    assert response.status_code == 200
    rows = response.json()
    assert [r["owner"]["kind"] for r in rows] == ["project", "organization"]
    org_row = rows[1]
    assert org_row["id"] == str(company.id)
    assert org_row["slug"] == "openai-company"
    assert org_row["header"]["name"] == "OpenAI"
    assert org_row["data"]["kind"] == "openai"
    assert org_row["value_status"] == {"configured": True}
    assert "availability" not in org_row and "selected_project_ids" not in org_row
    assert "key" not in org_row["data"]["provider"]
    assert SENTINEL_KEY not in response.text


async def _subscription_login(world):
    return await world["vault"].create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"provider": "chatgpt"},
                },
                "scope": "organization",
            }
        ),
        user_id=uuid4(),
    )


async def test_gateway_on_lists_every_organization_connection(world):
    await _org(world, slug="openai-company")
    await _subscription_login(world)
    rows = world["client"].get("/secrets/?include_organization=true").json()
    assert sorted(row["kind"] for row in rows) == [
        "provider_key",
        "subscription_provider",
    ]


async def test_gateway_off_lists_only_organization_subscription_logins(
    world, monkeypatch
):
    await _org(world, slug="openai-company")
    await _subscription_login(world)
    monkeypatch.setattr(env.llm_gateway, "enabled", False)
    rows = world["client"].get("/secrets/?include_organization=true").json()
    assert [row["kind"] for row in rows] == ["subscription_provider"]


async def test_member_projection_drops_other_project_ids(world):
    limited = await world["vault"].create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(
            org_secret_payload(slug="limited")
        ),
        user_id=uuid4(),
    )
    world["dao"].selected[limited.id] = [world["sales"], world["marketing"]]
    world["dao"].records[limited.id] = limited.model_copy(
        update={"availability": SecretAvailability.SELECTED_PROJECTS}
    )
    await world["vault"]._invalidate_organization(
        organization_id=world["organization_id"]
    )
    response = world["client"].get("/secrets/?include_organization=true")
    assert str(world["marketing"]) not in response.text
    assert "selected_project_ids" not in response.text


async def test_resolve_grant_never_receives_an_organization_value(world):
    await _org(world, slug="openai-company")
    plain = world["client"].get("/secrets/", headers={"x-test-grant": "1"})
    assert plain.status_code == 200 and plain.json() == []
    listed = world["client"].get(
        "/secrets/?include_organization=true", headers={"x-test-grant": "1"}
    )
    assert listed.status_code == 200
    assert [row["slug"] for row in listed.json()] == ["openai-company"]
    assert SENTINEL_KEY not in listed.text


async def test_project_routes_answer_404_for_an_organization_id_and_slug(world):
    company = await _org(world, slug="openai-company")
    client = world["client"]
    assert client.get(f"/secrets/{company.id}").status_code == 404
    assert client.get("/secrets/openai-company").status_code == 404
    assert (
        client.put(f"/secrets/{company.id}", json={"header": {"name": "x"}}).status_code
        == 404
    )
    assert company.id in world["dao"].records
    assert world["dao"].records[company.id].header.name == "OpenAI"


async def test_project_delete_of_an_organization_id_or_unknown_id_answers_204_and_changes_nothing(
    world,
):
    company = await _org(world, slug="openai-company")
    client = world["client"]
    before = {
        secret_id: record.model_dump(mode="json")
        for secret_id, record in world["dao"].records.items()
    }
    assert client.delete(f"/secrets/{company.id}").status_code == 204
    assert client.delete(f"/secrets/{uuid4()}").status_code == 204
    after = {
        secret_id: record.model_dump(mode="json")
        for secret_id, record in world["dao"].records.items()
    }
    assert after == before


async def test_a_project_row_may_reuse_an_organization_slug_with_any_kind(world):
    """No name rule joins the two scopes: an agent names the one it uses."""
    await _org(world, slug="openai-company")
    response = world["client"].post(
        "/secrets/",
        json={
            "slug": "openai-company",
            "header": {"name": "token"},
            "secret": {
                "kind": "custom_secret",
                "data": {"secret": {"format": "text", "content": "value-123456"}},
            },
        },
    )
    assert response.status_code == 200, response.text


async def test_the_sdk_vault_fallback_parses_the_new_list_response(world):
    """The SDK's vault fallback reads the list as plain dictionaries: the additive
    `owner`/`availability` fields change nothing for its connection resolution."""
    from agenta.sdk.agents.connections import ModelRef
    from agenta.sdk.agents.platform import connections as sdk_connections

    world["client"].post(
        "/secrets/", json=org_secret_payload(slug="mine", key="sk-proj-0123456789")
    )
    rows = world["client"].get("/secrets/", headers={"x-test-grant": "1"}).json()
    assert rows[0]["owner"]["kind"] == "project"
    resolved = sdk_connections._resolve_from_secrets(
        secrets=rows,
        model=ModelRef(
            provider="openai", model="gpt-5.5", connection={"mode": "agenta"}
        ),
        harness="pi_core",
    )
    values = {item.binding.name: item.value for item in resolved.credentials}
    assert values["OPENAI_API_KEY"] == "sk-proj-0123456789"


# --- Organization subscription logins (M5) -------------------------------------------------


def _codex_access_token(account_id: str = "acct-org") -> str:
    """An access token shaped like Codex's. The signature is filler; nothing checks it."""
    from base64 import urlsafe_b64encode
    from json import dumps

    def segment(payload: dict) -> str:
        return urlsafe_b64encode(dumps(payload).encode()).decode().rstrip("=")

    claims = {"https://api.openai.com/auth": {"chatgpt_account_id": account_id}}
    return f"{segment({'alg': 'RS256'})}.{segment(claims)}.signature"


def _expires_in(hours: float) -> int:
    from datetime import datetime, timezone

    return int(datetime.now(timezone.utc).timestamp() * 1000) + int(hours * 3_600_000)


ORG_LOGIN = {
    "type": "oauth",
    "access": _codex_access_token(),
    "refresh": "org-refresh-1",
    "expires": _expires_in(1),
    "accountId": "acct-org",
}


async def _org_subscription(world, *, login=None):
    created = await world["vault"].create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": "Company ChatGPT"},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"provider": "chatgpt"},
                },
            }
        ),
        user_id=uuid4(),
    )
    if login is not None:
        record = world["dao"].records[created.id]
        data = record.data.model_copy(
            update={
                "login": SubscriptionLoginDTO.model_validate(login),
                "login_state": "ready",
                "login_version": 3,
                "login_generation": 1,
            }
        )
        world["dao"].records[created.id] = record.model_copy(update={"data": data})
        await world["vault"]._invalidate_organization(
            organization_id=world["organization_id"]
        )
    return created


async def test_a_run_reads_the_organization_subscription_login_it_named(world):
    created = await _org_subscription(world, login=ORG_LOGIN)
    response = world["client"].get(
        f"/secrets/{created.slug}?scope=organization", headers={"x-test-grant": "1"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(created.id)
    assert body["owner"]["kind"] == "organization"
    assert body["data"]["login"]["refresh"] == "org-refresh-1"


async def test_only_the_runs_credential_reads_an_organization_subscription_login(world):
    created = await _org_subscription(world, login=ORG_LOGIN)
    response = world["client"].get(f"/secrets/{created.slug}?scope=organization")
    assert response.status_code == 403
    assert "org-refresh-1" not in response.text


async def test_the_release_route_serves_no_other_organization_kind(world):
    await _org(world, slug="openai-company")
    response = world["client"].get(
        "/secrets/openai-company?scope=organization",
        headers={"x-test-grant": "1"},
    )
    assert response.status_code == 404
    assert SENTINEL_KEY not in response.text


async def test_the_release_route_refuses_a_project_the_login_is_not_available_to(world):
    created = await _org_subscription(world, login=ORG_LOGIN)
    world["dao"].selected[created.id] = [world["sales"]]
    world["dao"].records[created.id] = (
        world["dao"]
        .records[created.id]
        .model_copy(update={"availability": SecretAvailability.SELECTED_PROJECTS})
    )
    await world["vault"]._invalidate_organization(
        organization_id=world["organization_id"]
    )
    world["state"]["project"] = world["marketing"]
    response = world["client"].get(
        f"/secrets/{created.slug}?scope=organization", headers={"x-test-grant": "1"}
    )
    assert response.status_code == 404
    assert "org-refresh-1" not in response.text


async def test_the_release_route_never_serves_a_project_subscription(world):
    created = world["client"].post(
        "/secrets/",
        json={
            "header": {"name": "ChatGPT"},
            "secret": {
                "kind": "subscription_provider",
                "data": {"provider": "chatgpt"},
            },
        },
    )
    assert created.status_code == 200, created.text
    response = world["client"].get(
        f"/secrets/{created.json()['slug']}?scope=organization",
        headers={"x-test-grant": "1"},
    )
    assert response.status_code == 404


async def test_a_run_pushes_a_refreshed_organization_login_with_scope_organization(
    world,
):
    created = await _org_subscription(world, login=ORG_LOGIN)
    refreshed = {**ORG_LOGIN, "refresh": "org-refresh-2", "expires": _expires_in(2)}
    body = {"login": refreshed, "version": 3, "generation": 1}

    # Without the scope the id names a project row, and there is none.
    project_scoped = world["client"].post(
        f"/secrets/{created.id}/subscription-login",
        json=body,
        headers={"x-test-grant": "1"},
    )
    assert project_scoped.status_code == 404
    assert world["dao"].records[created.id].data.login.refresh == "org-refresh-1"

    response = world["client"].post(
        f"/secrets/{created.id}/subscription-login?scope=organization",
        json=body,
        headers={"x-test-grant": "1"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["updated"] is True
    assert world["dao"].records[created.id].data.login.refresh == "org-refresh-2"


async def test_an_organization_login_push_needs_the_project_to_have_it(world):
    created = await _org_subscription(world, login=ORG_LOGIN)
    world["dao"].selected[created.id] = [world["sales"]]
    world["dao"].records[created.id] = (
        world["dao"]
        .records[created.id]
        .model_copy(update={"availability": SecretAvailability.SELECTED_PROJECTS})
    )
    await world["vault"]._invalidate_organization(
        organization_id=world["organization_id"]
    )
    world["state"]["project"] = world["marketing"]
    response = world["client"].post(
        f"/secrets/{created.id}/subscription-login?scope=organization",
        json={
            "login": {**ORG_LOGIN, "refresh": "org-refresh-2"},
            "version": 3,
            "generation": 1,
        },
        headers={"x-test-grant": "1"},
    )
    assert response.status_code == 404
    assert world["dao"].records[created.id].data.login.refresh == "org-refresh-1"


@pytest.mark.parametrize(
    "owners",
    [
        {},
        {"project_id": str(uuid4()), "organization_id": str(uuid4())},
    ],
)
def test_a_login_outcome_names_exactly_one_owner(owners):
    from pydantic import ValidationError

    from oss.src.apis.fastapi.vault.models import SubscriptionLoginOutcomeRequest

    with pytest.raises(ValidationError):
        SubscriptionLoginOutcomeRequest.model_validate(
            {"secret_id": str(uuid4()), "state": "expired", **owners}
        )
    for owner in ("project_id", "organization_id"):
        outcome = SubscriptionLoginOutcomeRequest.model_validate(
            {"secret_id": str(uuid4()), "state": "expired", owner: str(uuid4())}
        )
        assert getattr(outcome, owner) is not None
