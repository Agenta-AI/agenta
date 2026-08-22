"""Every vault route redacts write-only values for users; only the runtime grant reads them.

Drives the real `VaultRouter` + `VaultService` over an in-memory DAO, with the permission
check monkeypatched. The caller's principal is simulated by a test
middleware: requests with the `x-test-grant` header carry the secret-resolve grant (the
platform runtime); requests without it are ordinary user principals (session/ApiKey).
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from jwt import encode
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import oss.src.middlewares.auth as auth_module
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
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        stored = self.records.get(str(secret_id))
        if stored is None:
            return None

        # Production resolves the update against the row under the write lock; the fake
        # does the same at the same point, so keep-on-omit is exercised, not skipped.
        if resolve_update is not None:
            resolve_update(stored)

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


@pytest.fixture(name="harness")
def _harness(monkeypatch):
    dao = _FakeSecretsDAO()

    async def _allow(**kwargs):
        return True

    monkeypatch.setattr(vault_router_module, "check_action_access", _allow)

    app = FastAPI()

    @app.middleware("http")
    async def _principal(request, call_next):
        request.state.user_id = USER_ID
        request.state.project_id = PROJECT_ID
        if request.headers.get("x-test-grant"):
            request.state.token_grants = (SECRET_RESOLVE_GRANT,)
        return await call_next(request)

    app.include_router(VaultRouter(vault_service=VaultService(dao)).router)

    return TestClient(app)


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
    client = harness

    created = _create(client, write_only=True)

    assert created["write_only"] is True
    assert "key" not in created["data"]["provider"]
    assert created["has_key"] is True
    assert created["key_preview"] == "sk-****et"
    assert KEY not in str(created)


def test_create_without_the_flag_keeps_todays_response_while_the_gate_is_off(harness):
    # The current frontend sends no flag; until AGENTA_VAULT_WRITE_ONLY_DEFAULT flips on,
    # its creates must behave exactly as today.
    client = harness

    created = _create(client)

    assert created["write_only"] is False
    assert created["data"]["provider"]["key"] == KEY
    assert "has_key" not in created
    assert "key_preview" not in created


def test_create_without_the_flag_is_write_only_once_the_gate_is_on(
    harness, monkeypatch
):
    monkeypatch.setattr(env.agenta.vault, "write_only_default", True)
    client = harness

    created = _create(client)

    assert created["write_only"] is True
    assert "key" not in created["data"]["provider"]


def test_create_with_explicit_false_keeps_todays_response(harness):
    client = harness

    created = _create(client, write_only=False)

    assert created["write_only"] is False
    assert created["data"]["provider"]["key"] == KEY
    assert "has_key" not in created
    assert "key_preview" not in created


def test_read_is_redacted_for_users_and_plaintext_for_the_grant(harness):
    client = harness
    created = _create(client, write_only=True)

    user_read = client.get(f"/secrets/{created['id']}")
    assert user_read.status_code == 200
    assert "key" not in user_read.json()["data"]["provider"]

    runtime_read = client.get(f"/secrets/{created['id']}", headers=GRANT)
    assert runtime_read.status_code == 200
    assert runtime_read.json()["data"]["provider"]["key"] == KEY


def test_list_is_redacted_for_users(harness):
    client = harness
    _create(client, write_only=True)

    listed = client.get("/secrets/")
    assert listed.status_code == 200
    (secret,) = listed.json()
    assert "key" not in secret["data"]["provider"]
    assert secret["has_key"] is True
    assert KEY not in listed.text


def test_grant_list_gets_plaintext(harness):
    client = harness
    _create(client, write_only=True)

    runtime_list = client.get("/secrets/", headers=GRANT)
    assert runtime_list.status_code == 200
    (secret,) = runtime_list.json()
    assert secret["data"]["provider"]["key"] == KEY


def test_update_echo_is_redacted_and_omitted_key_keeps_the_stored_value(harness):
    client = harness
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
    client = harness
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
    client = harness
    created = _create(client, write_only=True)

    response = client.put(f"/secrets/{created['id']}", json={"write_only": False})

    assert response.status_code == 400
    assert "write-only" in response.json()["detail"]


def test_readable_secret_lists_with_its_value_as_today(harness):
    client = harness
    _create(client, write_only=False)

    (secret,) = client.get("/secrets/").json()

    assert secret["data"]["provider"]["key"] == KEY
    assert secret["write_only"] is False


def test_delete_still_works(harness):
    client = harness
    created = _create(client, write_only=True)

    assert client.delete(f"/secrets/{created['id']}").status_code == 204
    assert client.get(f"/secrets/{created['id']}").status_code == 404


def test_kind_or_family_change_without_a_new_value_is_400(harness):
    client = harness
    created = _create(client, write_only=True)

    response = client.put(
        f"/secrets/{created['id']}",
        json={
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "anthropic", "provider": {}},
            }
        },
    )

    assert response.status_code == 400
    assert "credential value" in response.json()["detail"]


# --- real signed tokens through the real verifier --------------------------------------

SECRET_KEY = "unit-test-secret-key-with-32-bytes"


@pytest.fixture(name="token_client")
def _token_client(monkeypatch):
    """Same router harness, but the principal comes from a REAL `Secret` token run
    through the real `verify_secret_token` — nothing injects `token_grants` directly."""
    monkeypatch.setattr(auth_module, "_SECRET_KEY", SECRET_KEY)

    dao = _FakeSecretsDAO()

    async def _allow(**kwargs):
        return True

    monkeypatch.setattr(vault_router_module, "check_action_access", _allow)

    app = FastAPI()

    @app.middleware("http")
    async def _authenticate(request, call_next):
        header = request.headers.get("authorization", "")
        if not header.startswith("Secret "):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        try:
            await auth_module.verify_secret_token(request, header[len("Secret ") :])
        except HTTPException as exc:
            return JSONResponse({"detail": "Unauthorized"}, status_code=exc.status_code)
        return await call_next(request)

    app.include_router(VaultRouter(vault_service=VaultService(dao)).router)

    return TestClient(app)


def _auth(token):
    return {"Authorization": f"Secret {token}"}


@pytest.mark.asyncio
async def test_real_tokens_grant_and_deny_plaintext(token_client):
    plain = await auth_module.sign_secret_token(user_id=USER_ID, project_id=PROJECT_ID)
    granted = await auth_module.sign_secret_token(
        user_id=USER_ID,
        project_id=PROJECT_ID,
        grants=[SECRET_RESOLVE_GRANT],
    )

    created = token_client.post(
        "/secrets/",
        json={
            "header": {"name": "OpenAI"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": KEY}},
            },
            "write_only": True,
        },
        headers=_auth(plain),
    )
    assert created.status_code == 200, created.text
    assert "key" not in created.json()["data"]["provider"]
    secret_id = created.json()["id"]

    ungranted_read = token_client.get(f"/secrets/{secret_id}", headers=_auth(plain))
    assert ungranted_read.status_code == 200
    assert "key" not in ungranted_read.json()["data"]["provider"]

    granted_read = token_client.get(f"/secrets/{secret_id}", headers=_auth(granted))
    assert granted_read.status_code == 200
    assert granted_read.json()["data"]["provider"]["key"] == KEY

    granted_list = token_client.get("/secrets/", headers=_auth(granted))
    (listed,) = granted_list.json()
    assert listed["data"]["provider"]["key"] == KEY


@pytest.mark.asyncio
async def test_expired_granted_token_is_rejected(token_client):
    # Encoded here rather than through `sign_secret_token`, which only ever issues a live
    # token; what is under test is the middleware refusing an expired one, grant or not.
    expired = encode(
        payload={
            "user_id": USER_ID,
            "project_id": PROJECT_ID,
            "grants": [SECRET_RESOLVE_GRANT],
            "exp": int(
                (datetime.now(timezone.utc) - timedelta(seconds=60)).timestamp()
            ),
        },
        key=auth_module._SECRET_KEY,
        algorithm="HS256",
    )

    response = token_client.get("/secrets/", headers=_auth(expired))

    assert response.status_code == 401


# --- schema + never-echo ---------------------------------------------------------------


def test_openapi_documents_the_write_only_contract(harness):
    client = harness

    schemas = client.app.openapi()["components"]["schemas"]

    for field in ("write_only", "has_key", "key_preview"):
        assert field in schemas["SecretResponseDTO"]["properties"]
    assert "write_only" in schemas["CreateSecretDTO"]["properties"]
    assert "write_only" in schemas["UpdateSecretDTO"]["properties"]


CANARY = "sk-CANARY-DO-NOT-ECHO-abc123"


def test_malformed_create_never_echoes_the_submitted_key(harness):
    client = harness

    response = client.post(
        "/secrets/",
        json={
            "header": {"name": "x"},
            "secret": {
                "kind": "invalid_kind",
                "data": {"kind": "openai", "provider": {"key": CANARY}},
            },
        },
    )

    assert response.status_code == 422
    assert CANARY not in response.text
