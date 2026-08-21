"""The `/access/permissions/check` exchange is the only place users' credentials become
grant-bearing runtime credentials — and only for an ALLOWED `run_service` exchange.

Drives the real `AccessRouter.check_permissions` handler with real token minting (the
returned credentials decode with the real key); only the permission verdict and the Redis
cache are faked.
"""

from uuid import uuid4

import pytest
from jwt import decode
from starlette.requests import Request

import oss.src.middlewares.auth as auth_module
from oss.src.apis.fastapi.access import router as access_router_module
from oss.src.apis.fastapi.access.router import AccessRouter
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT
from oss.src.utils.context import (
    AuthContext,
    AuthScope,
    SecretCredentials,
    reset_auth_context,
    set_auth_context,
)


SECRET_KEY = "unit-test-secret-key-with-32-bytes"

ORGANIZATION_ID = uuid4()
WORKSPACE_ID = uuid4()
PROJECT_ID = uuid4()
USER_ID = uuid4()


@pytest.fixture(name="exchange")
def _exchange(monkeypatch):
    monkeypatch.setattr(auth_module, "_SECRET_KEY", SECRET_KEY)

    verdict = {"allow": True}

    async def _check_action_access(**kwargs):
        return verdict["allow"]

    async def _get_cache(**kwargs):
        return None

    async def _set_cache(**kwargs):
        return True

    monkeypatch.setattr(
        access_router_module, "check_action_access", _check_action_access
    )
    monkeypatch.setattr(access_router_module, "get_cache", _get_cache)
    monkeypatch.setattr(access_router_module, "set_cache", _set_cache)

    router = AccessRouter()

    async def run(action, resource_type="service"):
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/access/permissions/check",
                "headers": [],
                "query_string": b"",
                "scheme": "http",
                "server": ("testserver", 80),
                "root_path": "",
            }
        )

        token = set_auth_context(
            AuthContext(
                credentials=SecretCredentials(value="caller-token"),
                scope=AuthScope(
                    organization_id=ORGANIZATION_ID,
                    workspace_id=WORKSPACE_ID,
                    project_id=PROJECT_ID,
                    user_id=USER_ID,
                ),
            )
        )
        try:
            return await router.check_permissions(
                request,
                action=action,
                scope_type=None,
                scope_id=None,
                resource_type=resource_type,
                resource_id=None,
            )
        finally:
            reset_auth_context(token)

    return run, verdict


def _claims(header_value: str) -> dict:
    assert header_value.startswith("Secret ")
    return decode(
        jwt=header_value[len("Secret ") :],
        key=SECRET_KEY,
        algorithms=["HS256"],
        options={"verify_exp": False},
    )


def _body(response) -> dict:
    import json

    return json.loads(response.body)


@pytest.mark.asyncio
async def test_allowed_run_service_exchange_returns_a_granted_credential(exchange):
    run, _ = exchange

    body = _body(await run("run_service"))

    assert body["effect"] == "allow"
    claims = _claims(body["credentials"])
    assert claims["grants"] == [SECRET_RESOLVE_GRANT]
    assert claims["project_id"] == str(PROJECT_ID)


@pytest.mark.asyncio
async def test_non_run_actions_never_receive_the_grant(exchange):
    run, _ = exchange

    body = _body(await run("view_secret", resource_type="local_secrets"))

    assert body["effect"] == "allow"
    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_denied_exchange_returns_no_credential_at_all(exchange):
    run, verdict = exchange
    verdict["allow"] = False

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as raised:
        await run("run_service")

    assert raised.value.status_code == 403


@pytest.mark.asyncio
async def test_missing_action_is_denied(exchange):
    run, _ = exchange

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as raised:
        await run(None)

    assert raised.value.status_code == 403
