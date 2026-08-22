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
from oss.src.utils.env import env
from oss.src.utils.context import (
    AuthContext,
    AuthScope,
    SecretCredentials,
    reset_auth_context,
    set_auth_context,
)


SECRET_KEY = "unit-test-secret-key-with-32-bytes"
RUNTIME_KEY = "unit-test-runtime-key-not-a-secret"

ORGANIZATION_ID = uuid4()
WORKSPACE_ID = uuid4()
PROJECT_ID = uuid4()
USER_ID = uuid4()


@pytest.fixture(name="exchange")
def _exchange(monkeypatch):
    monkeypatch.setattr(auth_module, "_SECRET_KEY", SECRET_KEY)
    monkeypatch.setattr(env.agenta, "services_internal_key", RUNTIME_KEY)

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

    async def run(action, resource_type="service", carried_grants=(), runtime_key=None):
        """Run the exchange as a principal whose credential carries ``carried_grants``.

        A session or ApiKey principal never has any: `verify_secret_token` is the only
        path that populates `token_grants`, and only from a verified Secret token.
        ``runtime_key`` is what the caller presents as the platform-runtime secret.
        """
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/access/permissions/check",
                "headers": (
                    [(b"x-agenta-runtime-key", runtime_key.encode())]
                    if runtime_key is not None
                    else []
                ),
                "query_string": b"",
                "scheme": "http",
                "server": ("testserver", 80),
                "root_path": "",
            }
        )
        request.state.token_grants = tuple(carried_grants)

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
async def test_a_granted_caller_keeps_the_grant_through_the_exchange(exchange):
    # The refresh path: the workflow service and the runner re-exchange the granted
    # credential a run was started with, and must get one back or the run loses its
    # ability to read the secrets it was authorized to use.
    run, _ = exchange

    body = _body(await run("run_service", carried_grants=(SECRET_RESOLVE_GRANT,)))

    assert body["effect"] == "allow"
    claims = _claims(body["credentials"])
    assert claims["grants"] == [SECRET_RESOLVE_GRANT]
    assert claims["project_id"] == str(PROJECT_ID)


@pytest.mark.asyncio
async def test_the_platform_runtime_is_issued_the_grant(exchange):
    # The path every product run takes: the workflow service exchanges the END USER's
    # credential on their behalf, so nothing about the token says "this is a run". The
    # runtime proves what it is with a secret only it holds.
    run, _ = exchange

    body = _body(await run("run_service", runtime_key=RUNTIME_KEY))

    claims = _claims(body["credentials"])
    assert claims["grants"] == [SECRET_RESOLVE_GRANT]


@pytest.mark.asyncio
async def test_a_wrong_runtime_key_is_not_the_runtime(exchange):
    run, _ = exchange

    body = _body(await run("run_service", runtime_key="not-the-key"))

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_the_runtime_key_only_grants_a_run_exchange(exchange):
    run, _ = exchange

    body = _body(await run("view_secret", runtime_key=RUNTIME_KEY))

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_an_unconfigured_deployment_grants_nobody(exchange, monkeypatch):
    # The placeholder is in the repo, so anyone could send it. A deployment that
    # configured no runtime key must issue no grant rather than accept a known string.
    monkeypatch.setattr(env.agenta, "services_internal_key", "replace-me")
    run, _ = exchange

    body = _body(await run("run_service", runtime_key="replace-me"))

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_the_admin_key_is_not_runtime_proof(exchange, monkeypatch):
    monkeypatch.setattr(env.agenta, "services_internal_key", None)
    run, _ = exchange

    body = _body(await run("run_service", runtime_key=env.agenta.auth_key))

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_a_plain_caller_cannot_mint_the_grant_by_asking_for_it(exchange):
    # The escalation this closes: a member who may run a service could call the exchange
    # with their own session or ApiKey — neither of which carries a grant — and spend the
    # returned credential on the vault routes to read every write-only value in plaintext.
    run, _ = exchange

    body = _body(await run("run_service"))

    assert body["effect"] == "allow"
    claims = _claims(body["credentials"])
    assert "grants" not in claims


@pytest.mark.asyncio
async def test_an_unrelated_carried_grant_is_not_forwarded(exchange):
    run, _ = exchange

    body = _body(await run("run_service", carried_grants=("some-other-grant",)))

    claims = _claims(body["credentials"])
    assert "grants" not in claims


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
