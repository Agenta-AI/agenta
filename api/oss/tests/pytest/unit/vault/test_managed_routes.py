from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.vault import router as router_module
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.managed import SecretManagementDTO, SecretManager
from oss.src.core.secrets.services import VaultService


PROJECT_ID = str(uuid4())
USER_ID = str(uuid4())


class _DAO:
    def __init__(self):
        self.record = SecretResponseDTO(
            id=uuid4(),
            slug="managed",
            kind="provider_key",
            data={"kind": "openai", "provider": {"key": "sk-managed"}},
            header={"name": "Managed"},
            write_only=False,
            management=SecretManagementDTO(
                manager=SecretManager.STARTER_CREDITS_BRIDGE
            ),
        )

    async def list(self, project_id, organization_id):
        return [self.record]

    async def get_by_id(self, secret_id, project_id, organization_id):
        return self.record if secret_id == self.record.id else None

    async def get_by_slug(self, secret_slug, project_id, organization_id):
        return self.record if secret_slug == self.record.slug else None

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        if resolve_update:
            resolve_update(self.record, update_secret_dto)
        return self.record

    async def delete(
        self, secret_id, project_id, organization_id, authorize_delete=None
    ):
        if authorize_delete:
            authorize_delete(self.record)


@pytest.fixture
def client(monkeypatch):
    async def allow(**kwargs):
        return True

    monkeypatch.setattr(router_module, "check_action_access", allow)
    app = FastAPI()

    @app.middleware("http")
    async def principal(request, call_next):
        request.state.user_id = USER_ID
        request.state.project_id = PROJECT_ID
        return await call_next(request)

    app.include_router(VaultRouter(vault_service=VaultService(_DAO())).router)
    return TestClient(app)


def test_public_response_exposes_policy_without_manager(client):
    response = client.get("/secrets/")
    assert response.status_code == 200
    management = response.json()[0]["management"]
    assert management == {"policy": "manager_only"}
    assert "manager" not in management


def test_managed_update_and_delete_are_conflicts(client):
    secret = client.get("/secrets/").json()[0]
    update = client.put(
        f"/secrets/{secret['id']}",
        json={"header": {"name": "No"}},
    )
    delete = client.delete(f"/secrets/{secret['id']}")
    assert update.status_code == 409
    assert delete.status_code == 409


@pytest.mark.parametrize("field", ["management", "managed_by"])
def test_public_requests_reject_management_fields(client, field):
    response = client.post(
        "/secrets/",
        json={
            "header": {"name": "Mine"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "sk-mine"}},
            },
            field: {"manager": "starter-credits-bridge"},
        },
    )
    assert response.status_code == 422
