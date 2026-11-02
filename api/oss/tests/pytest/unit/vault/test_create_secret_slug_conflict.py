"""A secret created under a slug the project already holds is refused as a conflict.

Agenta-AI/agenta#6928. The connect sheet's create-secret drawer suggests a name from the
server (`GITHUB_API_KEY`), and its slug follows the name. A second secret for the same server
reached the unique index, and the refusal escaped the route as `500 An unexpected error
occurred` with the operation `create_secret`, so the drawer could only report a server
failure. The route now answers 409 with the reason.

Drives the real `VaultRouter` + `VaultService` over an in-memory DAO that enforces the
`(project_id, slug)` index the way the Postgres DAO reports it. The caller's project comes
from the `x-test-project` header, so one test can act as two projects.
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.vault import router as vault_router_module
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.claude_token import ClaudeTokenClient
from oss.src.core.secrets.subscription_login import SubscriptionLoginRunnerClient
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.src.core.secrets.types import SecretSlugConflict
from oss.tests.pytest.utils.organization_secrets import owner_scope


PROJECT_ID = str(uuid4())
OTHER_PROJECT_ID = str(uuid4())


class _UniqueSlugSecretsDAO:
    def __init__(self):
        self.records: dict = {}

    async def create(
        self,
        *,
        owner,
        create_secret_dto,
        **_kwargs,
    ):
        project_id, organization_id = owner_scope(owner)
        key = (project_id, create_secret_dto.slug)
        if key in self.records:
            raise SecretSlugConflict(slug=create_secret_dto.slug)
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
            write_only=bool(create_secret_dto.write_only),
        )
        self.records[key] = record
        return record


@pytest.fixture(name="client")
def _client(monkeypatch):
    async def _allow(**kwargs):
        return True

    monkeypatch.setattr(vault_router_module, "check_action_access", _allow)

    vault_service = VaultService(_UniqueSlugSecretsDAO())
    router = VaultRouter(
        vault_service=vault_service,
        subscription_login_service=SubscriptionLoginService(
            vault_service=vault_service,
            runner_client=SubscriptionLoginRunnerClient(base_url="", token=""),
            claude_token_client=ClaudeTokenClient(),
        ),
    )

    app = FastAPI()

    user_id = str(uuid4())

    @app.middleware("http")
    async def _principal(request, call_next):
        request.state.user_id = user_id
        request.state.project_id = request.headers.get("x-test-project", PROJECT_ID)
        return await call_next(request)

    app.include_router(router.router)
    return TestClient(app)


def _drawer_body(name: str, slug: str) -> dict:
    """What the create-secret drawer sends: a text custom secret under a derived slug."""
    return {
        "slug": slug,
        "header": {"name": name},
        "secret": {
            "kind": "custom_secret",
            "data": {"secret": {"format": "text", "content": "test-key-one"}},
        },
    }


def test_a_taken_slug_is_a_conflict_with_its_reason_not_a_server_error(client):
    first = client.post(
        "/secrets/", json=_drawer_body("GITHUB_API_KEY", "github_api_key")
    )
    assert first.status_code == 200, first.text

    again = client.post(
        "/secrets/", json=_drawer_body("GITHUB_API_KEY", "github_api_key")
    )

    assert again.status_code == 409, again.text
    assert again.json()["detail"] == (
        "A secret already exists with the slug github_api_key. Choose another slug."
    )


def test_a_fresh_slug_is_still_created(client):
    client.post("/secrets/", json=_drawer_body("GITHUB_API_KEY", "github_api_key"))

    other = client.post("/secrets/", json=_drawer_body("GITHUB_TOKEN", "github_token"))

    assert other.status_code == 200, other.text
    assert other.json()["slug"] == "github_token"


def test_another_project_can_use_the_same_slug(client):
    client.post("/secrets/", json=_drawer_body("GITHUB_API_KEY", "github_api_key"))

    elsewhere = client.post(
        "/secrets/",
        json=_drawer_body("GITHUB_API_KEY", "github_api_key"),
        headers={"x-test-project": OTHER_PROJECT_ID},
    )

    assert elsewhere.status_code == 200, elsewhere.text
