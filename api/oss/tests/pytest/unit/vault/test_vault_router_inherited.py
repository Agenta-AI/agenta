"""`GET /secrets/?include_inherited=true` and the project routes against organization rows
(M5, Task 8)."""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import oss.src.core.secrets.services as services_module
from oss.src.apis.fastapi.vault import router as router_module
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.secrets.claude_token import ClaudeTokenClient
from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.enums import SecretAvailability
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import SubscriptionLoginRunnerClient
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT
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
    assert "overridden_by_secret_id" not in rows[0]


async def test_include_inherited_adds_inherited_rows_without_values(world):
    inherited = await _org(world, slug="openai-company")
    client = world["client"]
    override = client.post(
        "/secrets/",
        json=org_secret_payload(slug="openai-company", key="sk-proj-0123456789"),
    ).json()
    response = client.get("/secrets/?include_inherited=true")
    assert response.status_code == 200
    rows = response.json()
    assert [r["owner"]["kind"] for r in rows] == ["project", "organization"]
    org_row = rows[1]
    assert org_row["id"] == str(inherited.id)
    assert org_row["slug"] == "openai-company"
    assert org_row["header"]["name"] == "OpenAI"
    assert org_row["data"]["kind"] == "openai"
    assert org_row["value_status"] == {"configured": True}
    assert org_row["overridden_by_secret_id"] == override["id"]
    assert "availability" not in org_row and "selected_project_ids" not in org_row
    assert "key" not in org_row["data"]["provider"]
    assert SENTINEL_KEY not in response.text


async def test_inherited_projection_drops_other_project_ids(world):
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
    response = world["client"].get("/secrets/?include_inherited=true")
    assert str(world["marketing"]) not in response.text
    assert "selected_project_ids" not in response.text


async def test_resolve_grant_never_receives_inherited_rows(world):
    await _org(world, slug="openai-company")
    for path in ("/secrets/", "/secrets/?include_inherited=true"):
        response = world["client"].get(path, headers={"x-test-grant": "1"})
        assert response.status_code == 200
        assert response.json() == []
        assert SENTINEL_KEY not in response.text


async def test_project_routes_answer_404_for_an_organization_id_and_slug(world):
    inherited = await _org(world, slug="openai-company")
    client = world["client"]
    assert client.get(f"/secrets/{inherited.id}").status_code == 404
    assert client.get("/secrets/openai-company").status_code == 404
    assert (
        client.put(
            f"/secrets/{inherited.id}", json={"header": {"name": "x"}}
        ).status_code
        == 404
    )
    assert client.delete(f"/secrets/{inherited.id}").status_code == 404
    assert inherited.id in world["dao"].records
    assert world["dao"].records[inherited.id].header.name == "OpenAI"


async def test_post_with_an_inherited_slug_and_another_kind_answers_409(world):
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
    assert response.status_code == 409
    assert "another kind or provider" in response.json()["detail"]
    response = world["client"].post(
        "/secrets/", json=org_secret_payload(slug="openai-company", family="anthropic")
    )
    assert response.status_code == 409


async def test_old_sdk_parses_the_new_list_response(world):
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
