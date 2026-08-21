"""Every vault route redacts write-only values for users; only the runtime grant reads them.

Drives the real `VaultRouter` + `VaultService` over an in-memory DAO, with the permission
check and the Redis cache monkeypatched. The caller's principal is simulated by a test
middleware: requests with the `x-test-grant` header carry the secret-resolve grant (the
platform runtime); requests without it are ordinary user principals (session/ApiKey).
"""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.vault import router as vault_router_module
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.services import VaultService
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT
from oss.src.utils.env import env


PROJECT_ID = str(uuid4())
USER_ID = str(uuid4())

KEY = "sk-test-openai-secret"


class _FakeSecretsDAO:
    def __init__(self):
        self.records: dict = {}

    async def create(self, project_id, organization_id, create_secret_dto):
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
            write_only=bool(create_secret_dto.write_only),
        )
        self.records[str(record.id)] = record
        return record

    async def list(self, project_id, organization_id):
        return list(self.records.values())

    async def get_by_id(self, secret_id, project_id, organization_id):
        return self.records.get(str(secret_id))

    async def get_by_slug(self, secret_slug, project_id, organization_id):
        return next(
            (r for r in self.records.values() if r.slug == secret_slug),
            None,
        )

    async def update(
        self, secret_id, update_secret_dto, project_id, organization_id, user_id=None
    ):
        stored = self.records.get(str(secret_id))
        if stored is None:
            return None

        write_only = update_secret_dto.write_only
        if write_only is None:
            write_only = stored.write_only

        updated = stored.model_copy(
            update={
                "header": update_secret_dto.header or stored.header,
                "write_only": write_only,
            }
        )
        if update_secret_dto.secret is not None:
            updated.kind = update_secret_dto.secret.kind
            updated.data = update_secret_dto.secret.data

        self.records[str(secret_id)] = updated
        return updated

    async def delete(self, secret_id, project_id, organization_id):
        self.records.pop(str(secret_id), None)


class _FakeCache:
    def __init__(self):
        self.store = {}

    async def get_cache(self, *, project_id, namespace, key, model=None, is_list=False):
        return self.store.get(namespace)

    async def set_cache(self, *, project_id, namespace, key, value):
        self.store[namespace] = value

    async def invalidate_cache(self, *, project_id):
        self.store.clear()


@pytest.fixture(name="harness")
def _harness(monkeypatch):
    cache = _FakeCache()
    dao = _FakeSecretsDAO()

    async def _allow(**kwargs):
        return True

    monkeypatch.setattr(vault_router_module, "check_action_access", _allow)
    monkeypatch.setattr(vault_router_module, "get_cache", cache.get_cache)
    monkeypatch.setattr(vault_router_module, "set_cache", cache.set_cache)
    monkeypatch.setattr(vault_router_module, "invalidate_cache", cache.invalidate_cache)

    app = FastAPI()

    @app.middleware("http")
    async def _principal(request, call_next):
        request.state.user_id = USER_ID
        request.state.project_id = PROJECT_ID
        if request.headers.get("x-test-grant"):
            request.state.token_grants = (SECRET_RESOLVE_GRANT,)
        return await call_next(request)

    app.include_router(VaultRouter(vault_service=VaultService(dao)).router)

    return TestClient(app), cache


GRANT = {"x-test-grant": "1"}


def _create(client, write_only=None, key=KEY):
    body = {
        "header": {"name": "OpenAI"},
        "secret": {
            "kind": "provider_key",
            "data": {"kind": "openai", "provider": {"key": key}},
        },
    }
    if write_only is not None:
        body["write_only"] = write_only
    response = client.post("/secrets/", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_create_echo_is_redacted_for_a_write_only_secret(harness):
    client, _ = harness

    created = _create(client, write_only=True)

    assert created["write_only"] is True
    assert "key" not in created["data"]["provider"]
    assert created["has_key"] is True
    assert created["key_preview"] == "sk-****abc"
    assert KEY not in str(created)


def test_create_without_the_flag_keeps_todays_response_while_the_gate_is_off(harness):
    # The current frontend sends no flag; until AGENTA_VAULT_WRITE_ONLY_DEFAULT flips on,
    # its creates must behave exactly as today.
    client, _ = harness

    created = _create(client)

    assert created["write_only"] is False
    assert created["data"]["provider"]["key"] == KEY
    assert "has_key" not in created
    assert "key_preview" not in created


def test_create_without_the_flag_is_write_only_once_the_gate_is_on(
    harness, monkeypatch
):
    monkeypatch.setattr(env.agenta.vault, "write_only_default", True)
    client, _ = harness

    created = _create(client)

    assert created["write_only"] is True
    assert "key" not in created["data"]["provider"]


def test_create_with_explicit_false_keeps_todays_response(harness):
    client, _ = harness

    created = _create(client, write_only=False)

    assert created["write_only"] is False
    assert created["data"]["provider"]["key"] == KEY
    assert "has_key" not in created
    assert "key_preview" not in created


def test_read_is_redacted_for_users_and_plaintext_for_the_grant(harness):
    client, _ = harness
    created = _create(client, write_only=True)

    user_read = client.get(f"/secrets/{created['id']}")
    assert user_read.status_code == 200
    assert "key" not in user_read.json()["data"]["provider"]

    runtime_read = client.get(f"/secrets/{created['id']}", headers=GRANT)
    assert runtime_read.status_code == 200
    assert runtime_read.json()["data"]["provider"]["key"] == KEY


def test_list_is_redacted_and_the_cache_stores_the_redacted_shape(harness):
    client, cache = harness
    _create(client, write_only=True)

    listed = client.get("/secrets/")
    assert listed.status_code == 200
    (secret,) = listed.json()
    assert "key" not in secret["data"]["provider"]
    assert secret["has_key"] is True

    # What went into Redis is the redacted DTO: no plaintext at rest in the cache.
    (cached,) = cache.store["list_secrets"]
    assert cached.data.provider.key is None
    assert cached.has_key is True


def test_grant_list_bypasses_the_redacted_cache_and_gets_plaintext(harness):
    client, _ = harness
    _create(client, write_only=True)

    # A user listing first populates the cache with the redacted shape.
    client.get("/secrets/")

    runtime_list = client.get("/secrets/", headers=GRANT)
    assert runtime_list.status_code == 200
    (secret,) = runtime_list.json()
    assert secret["data"]["provider"]["key"] == KEY


def test_update_echo_is_redacted_and_omitted_key_keeps_the_stored_value(harness):
    client, _ = harness
    created = _create(client, write_only=True)

    updated = client.put(
        f"/secrets/{created['id']}",
        json={
            "header": {"name": "OpenAI (renamed)"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {}},
            },
        },
    )
    assert updated.status_code == 200, updated.text
    assert "key" not in updated.json()["data"]["provider"]
    assert updated.json()["header"]["name"] == "OpenAI (renamed)"

    # The grant read proves the stored value survived the value-less update.
    runtime_read = client.get(f"/secrets/{created['id']}", headers=GRANT)
    assert runtime_read.json()["data"]["provider"]["key"] == KEY


def test_todays_edit_form_shape_empty_string_key_keeps_the_stored_value(harness):
    # The CURRENT frontend cannot prefill a redacted value, so its edit form re-sends
    # `key: ""`. If "" cleared the credential, every edit through today's UI would wipe a
    # write-only secret — so empty string must mean "keep the stored value".
    client, _ = harness
    created = _create(client, write_only=True)

    updated = client.put(
        f"/secrets/{created['id']}",
        json={
            "header": {"name": "OpenAI (edited in today's UI)"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": ""}},
            },
        },
    )
    assert updated.status_code == 200, updated.text

    runtime_read = client.get(f"/secrets/{created['id']}", headers=GRANT)
    assert runtime_read.json()["data"]["provider"]["key"] == KEY


def test_write_only_cannot_be_disabled_over_the_api(harness):
    client, _ = harness
    created = _create(client, write_only=True)

    response = client.put(f"/secrets/{created['id']}", json={"write_only": False})

    assert response.status_code == 400
    assert "write-only" in response.json()["detail"]


def test_readable_secret_lists_with_its_value_as_today(harness):
    client, _ = harness
    _create(client, write_only=False)

    (secret,) = client.get("/secrets/").json()

    assert secret["data"]["provider"]["key"] == KEY
    assert secret["write_only"] is False


def test_delete_still_works(harness):
    client, _ = harness
    created = _create(client, write_only=True)

    assert client.delete(f"/secrets/{created['id']}").status_code == 204
    assert client.get(f"/secrets/{created['id']}").status_code == 404
