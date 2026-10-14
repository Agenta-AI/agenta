"""A secret created under a slug the project already holds is refused as a conflict.

Agenta-AI/agenta#6928. The connect sheet's create-secret drawer suggests a name from the
server (`GITHUB_API_KEY`), and its slug follows the name. A second secret for the same server
reached the unique index, and the refusal escaped the route as `500 An unexpected error
occurred` with the operation `create_secret`, so the drawer could only report a server
failure. The route now answers 409 with the reason.

Drives the real `VaultRouter` + `VaultService` over an in-memory DAO that enforces the
`(project_id, slug)` index the way the Postgres DAO reports it.
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.vault import router as vault_router_module
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import SubscriptionLoginRunnerClient
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.src.core.secrets.types import SecretSlugConflict


class _UniqueSlugSecretsDAO:
    def __init__(self):
        self.records: dict = {}

    async def create(self, project_id, organization_id, create_secret_dto):
        if create_secret_dto.slug in self.records:
            raise SecretSlugConflict(slug=create_secret_dto.slug)
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
            write_only=bool(create_secret_dto.write_only),
        )
        self.records[create_secret_dto.slug] = record
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
        ),
    )

    app = FastAPI()

    @app.middleware("http")
    async def _principal(request, call_next):
        request.state.user_id = str(uuid4())
        request.state.project_id = str(uuid4())
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
