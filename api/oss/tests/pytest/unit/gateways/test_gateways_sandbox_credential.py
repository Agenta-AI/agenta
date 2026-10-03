"""What the credential inside the agent sandbox may do (OD24 / OR38).

The gateway exists so that a provider key never enters the sandbox. Before this, the
sandbox was handed the runtime's own credential, which carries the `secret-resolve` grant,
so code running in the sandbox could ask the vault for the very key the gateway was holding
on its behalf. These cases pin the repair on both sides: the credential the exchange issues
is refused off the gateway data plane and carries no grant, and the runtime's granted
credential keeps working exactly where it did.

Every token here is minted with a synthetic signing key and authenticates to nothing.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from jwt import decode, encode
from starlette.requests import Request as StarletteRequest

from oss.src.apis.fastapi.gateways import (
    credentials_router as credentials_router_module,
)
from oss.src.apis.fastapi.gateways.credentials_router import GatewayCredentialsRouter
from oss.src.middlewares import auth
from oss.src.utils.env import env
from oss.src.utils.context import AuthScope
from oss.src.utils.exceptions import UnauthorizedException

SECRET_KEY = "unit-test-secret-key-with-32-bytes"

PROJECT_ID = str(uuid4())
WORKSPACE_ID = str(uuid4())
ORGANIZATION_ID = str(uuid4())
USER_ID = str(uuid4())

RUN_ID = "0123456789abcdef0123456789abcdef"

# One route of each kind the question is about.
LLM_RELAY_PATH = "/gateways/llms/standard/openai/v1/chat/completions"
MCP_RELAY_PATH = "/gateways/mcps/custom/notion"
VAULT_PATH = "/vault/v1/secrets/"
OTHER_PATH = "/workflows/revisions/commit"
EXCHANGE_PATH = "/gateways/credentials"


@pytest.fixture(autouse=True)
def _signing_key(monkeypatch):
    monkeypatch.setattr(auth, "_SECRET_KEY", SECRET_KEY)


def _request(path: str, *, credentials: str) -> StarletteRequest:
    """A request carrying the credential the way the sandbox sends it."""
    return StarletteRequest(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [(b"x-ag-credentials", credentials.encode())],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


def _claims(token: str) -> dict:
    return decode(
        jwt=token,
        key=SECRET_KEY,
        algorithms=["HS256"],
        options={"verify_exp": False, "verify_aud": False},
    )


async def _runtime_credential() -> str:
    """What `core/workflows/service.py` mints for a run: general-purpose, granted."""
    token = await auth.sign_secret_token(
        user_id=USER_ID,
        project_id=PROJECT_ID,
        workspace_id=WORKSPACE_ID,
        organization_id=ORGANIZATION_ID,
        gateway_run_id=RUN_ID,
        grants=[auth.SECRET_RESOLVE_GRANT],
    )
    return f"Secret {token}"


@pytest.fixture(name="exchange")
def _exchange(monkeypatch):
    """The real exchange route behind the real auth middleware.

    The client presents a credential; the app authenticates it the way production does and
    the route answers with the credential the sandbox is meant to hold.
    """
    monkeypatch.setattr(
        credentials_router_module,
        "get_auth_scope",
        lambda: AuthScope(
            organization_id=ORGANIZATION_ID,
            workspace_id=WORKSPACE_ID,
            project_id=PROJECT_ID,
            user_id=USER_ID,
        ),
    )

    app = FastAPI()

    @app.middleware("http")
    async def _authenticate(request: Request, call_next):
        try:
            await auth._check_authentication_token(request)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return await call_next(request)

    app.include_router(GatewayCredentialsRouter().router, prefix="/gateways")

    @app.get(LLM_RELAY_PATH)
    async def _llm_relay(request: Request):
        return {"project_id": request.state.project_id}

    @app.get(MCP_RELAY_PATH)
    async def _mcp_relay(request: Request):
        return {"run_id": getattr(request.state, "gateway_run_id", None)}

    @app.get(VAULT_PATH)
    async def _vault(request: Request):
        return {
            "reveals_write_only": auth.request_has_grant(
                request, auth.SECRET_RESOLVE_GRANT
            )
        }

    @app.get(OTHER_PATH)
    async def _other(request: Request):
        return {"project_id": request.state.project_id}

    return TestClient(app)


async def _sandbox_credential(exchange: TestClient) -> str:
    """The credential the SDK hands to the sandbox, obtained the way the SDK obtains it."""
    response = exchange.post(
        EXCHANGE_PATH,
        headers={"Authorization": await _runtime_credential()},
        json={},
    )
    assert response.status_code == 200, response.text
    return response.json()["credentials"]


# --- the credential the sandbox holds ---------------------------------------------------


@pytest.mark.asyncio
async def test_the_sandbox_credential_is_refused_on_the_vault_secrets_route(exchange):
    credentials = await _sandbox_credential(exchange)

    response = exchange.get(VAULT_PATH, headers={"X-AG-Credentials": credentials})

    assert response.status_code == 401
    assert response.json()["reason"] == "audience_mismatch"


@pytest.mark.asyncio
async def test_the_sandbox_credential_cannot_reveal_a_write_only_secret_value(exchange):
    """Belt and braces for the route above: even reaching the handler reveals nothing.

    The vault projects plaintext write-only values to whoever carries the `secret-resolve`
    grant. The exchanged credential carries no grants at all, so the projection the sandbox
    is after is off regardless of which route it finds its way onto.
    """
    credentials = await _sandbox_credential(exchange)
    token = credentials.removeprefix("Secret ")

    assert "grants" not in _claims(token)

    # Verified on a route it IS allowed on, then asked the question the vault asks.
    request = _request(LLM_RELAY_PATH, credentials=credentials)
    await auth.verify_secret_token(request=request, secret_token=token)

    assert not auth.request_has_grant(request, auth.SECRET_RESOLVE_GRANT)


@pytest.mark.asyncio
async def test_the_sandbox_credential_authenticates_both_gateway_relay_planes(exchange):
    credentials = await _sandbox_credential(exchange)

    llm = exchange.get(LLM_RELAY_PATH, headers={"X-AG-Credentials": credentials})
    mcp = exchange.get(MCP_RELAY_PATH, headers={"X-AG-Credentials": credentials})

    assert llm.status_code == 200
    assert llm.json() == {"project_id": PROJECT_ID}
    # The run id rides across the exchange, so the Agenta builtin MCP route still knows
    # which run's callback tools it is serving.
    assert mcp.status_code == 200
    assert mcp.json() == {"run_id": RUN_ID}


@pytest.mark.asyncio
async def test_the_sandbox_credential_is_refused_on_an_ordinary_platform_route(
    exchange,
):
    credentials = await _sandbox_credential(exchange)

    response = exchange.get(OTHER_PATH, headers={"X-AG-Credentials": credentials})

    assert response.status_code == 401
    assert response.json()["reason"] == "audience_mismatch"


@pytest.mark.asyncio
async def test_the_sandbox_credential_cannot_buy_itself_a_second_credential(exchange):
    """The exchange is not a data-plane route, so what it issues cannot re-enter it."""
    credentials = await _sandbox_credential(exchange)

    response = exchange.post(
        EXCHANGE_PATH, headers={"Authorization": credentials}, json={}
    )

    assert response.status_code == 401
    assert response.json()["reason"] == "audience_mismatch"


# --- the credential the runtime keeps ---------------------------------------------------


@pytest.mark.asyncio
async def test_the_granted_runtime_credential_still_works_where_it_did(exchange):
    """The services tier resolves vault values the gateway does not yet cover.

    Narrowing what the SANDBOX holds must not narrow what the RUNTIME holds, so the granted
    credential still reads the vault, still reaches ordinary routes, and still relays.
    """
    credentials = await _runtime_credential()

    for path in (VAULT_PATH, OTHER_PATH, LLM_RELAY_PATH):
        response = exchange.get(path, headers={"X-AG-Credentials": credentials})
        assert response.status_code == 200, (path, response.text)

    vault = exchange.get(VAULT_PATH, headers={"X-AG-Credentials": credentials})
    assert vault.json() == {"reveals_write_only": True}


# --- the claim itself -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_exchange_issues_a_gateway_audience_credential_with_no_grants(
    exchange,
):
    credentials = await _sandbox_credential(exchange)

    claims = _claims(credentials.removeprefix("Secret "))

    assert claims["aud"] == auth.GATEWAY_TOKEN_AUDIENCE
    assert "grants" not in claims
    assert claims["project_id"] == PROJECT_ID
    assert claims["gateway_run_id"] == RUN_ID


@pytest.mark.asyncio
async def test_the_exchange_carries_the_session_and_agent_labels(exchange):
    response = exchange.post(
        EXCHANGE_PATH,
        headers={"Authorization": await _runtime_credential()},
        json={"plane": "llm", "session_id": "session-1", "agent_id": "agent-1"},
    )
    assert response.status_code == 200, response.text
    token = response.json()["credentials"].removeprefix("Secret ")

    assert _claims(token)["gateway_run_labels"] == {
        "session_id": "session-1",
        "agent_id": "agent-1",
    }


@pytest.mark.asyncio
async def test_an_unlabelled_exchange_mints_no_labels_claim(exchange):
    credentials = await _sandbox_credential(exchange)

    assert "gateway_run_labels" not in _claims(credentials.removeprefix("Secret "))


@pytest.mark.asyncio
async def test_an_audience_and_a_grant_cannot_be_minted_onto_one_token():
    with pytest.raises(ValueError, match="cannot carry grants"):
        await auth.sign_secret_token(
            user_id=USER_ID,
            project_id=PROJECT_ID,
            grants=[auth.SECRET_RESOLVE_GRANT],
            audience=auth.GATEWAY_TOKEN_AUDIENCE,
        )


@pytest.mark.asyncio
async def test_a_forged_token_claiming_both_is_refused_rather_than_downgraded():
    """`sign_secret_token` cannot produce this pair, so a token carrying it is not ours."""
    expiry = datetime.now(timezone.utc) + timedelta(seconds=600)
    forged = encode(
        payload={
            "user_id": USER_ID,
            "project_id": PROJECT_ID,
            "aud": auth.GATEWAY_TOKEN_AUDIENCE,
            "grants": [auth.SECRET_RESOLVE_GRANT],
            "exp": int(expiry.timestamp()),
        },
        key=SECRET_KEY,
        algorithm="HS256",
    )

    with pytest.raises(UnauthorizedException) as refusal:
        await auth.verify_secret_token(
            request=_request(LLM_RELAY_PATH, credentials=f"Secret {forged}"),
            secret_token=forged,
        )

    assert refusal.value.detail["reason"] == "invalid_token"


@pytest.mark.asyncio
async def test_an_unknown_audience_is_refused_at_issuance_and_at_consumption():
    with pytest.raises(ValueError, match="unsupported audience"):
        await auth.sign_secret_token(user_id=USER_ID, audience="anything-else")

    expiry = datetime.now(timezone.utc) + timedelta(seconds=600)
    forged = encode(
        payload={
            "user_id": USER_ID,
            "aud": "anything-else",
            "exp": int(expiry.timestamp()),
        },
        key=SECRET_KEY,
        algorithm="HS256",
    )

    with pytest.raises(UnauthorizedException):
        await auth.verify_secret_token(
            request=_request(LLM_RELAY_PATH, credentials=f"Secret {forged}"),
            secret_token=forged,
        )


def test_the_exchange_never_asks_for_the_plaintext_vault_grant():
    """A source guard, because re-adding the grant here would be silent and total.

    The exchange is the only mint site on the sandbox's path. Copying a granted mint call
    into it would hand the sandbox back exactly what OR38 found, and every behavioural case
    above would still pass on the audience alone.
    """
    source = Path(credentials_router_module.__file__).read_text(encoding="utf-8")

    assert "SECRET_RESOLVE_GRANT" not in source
    assert "grants=" not in source


# --- how long it lives ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_gateway_credential_lives_as_long_as_the_setting_says(exchange):
    """A turn may run for hours; this credential must outlast it.

    Nothing re-mints the credential mid-turn and nothing delivers a new one into a running
    sandbox, so its lifetime is a hard ceiling on how long an agent may reach a gateway MCP
    server or the LLM gateway. At the 15 minutes every other secret token gets, a single long
    turn lost both partway through.
    """
    credentials = await _sandbox_credential(exchange)

    claims = _claims(credentials.removeprefix("Secret "))

    assert claims["exp"] - claims["iat"] == env.gateway_credentials.ttl_seconds


@pytest.mark.asyncio
async def test_an_ordinary_secret_token_keeps_the_short_life(exchange):
    """The longer life belongs to this one route, not to secret tokens generally.

    Every other token is handed to a browser or a short server-to-server hop, where a short
    life is the point of it.
    """
    token = (await _runtime_credential()).removeprefix("Secret ")

    claims = _claims(token)

    assert claims["exp"] - claims["iat"] == 15 * 60


@pytest.mark.asyncio
async def test_an_operator_can_shorten_or_lengthen_it(exchange, monkeypatch):
    """The setting is read per mint, so an operator's value is the one that ships."""
    monkeypatch.setattr(env.gateway_credentials, "ttl_seconds", 1800)

    credentials = await _sandbox_credential(exchange)

    claims = _claims(credentials.removeprefix("Secret "))

    assert claims["exp"] - claims["iat"] == 1800
