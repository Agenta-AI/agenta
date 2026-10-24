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
from oss.src.apis.fastapi.gateways.llms import proxy as llm_proxy_module
from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy
from oss.src.apis.fastapi.gateways.mcps.models import MCPAgentaCredentialRequest
from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter
from oss.src.core.gateways.llms.interfaces import LLMRelayResult
from oss.src.middlewares import auth
from oss.src.utils.env import env
from oss.src.utils.context import AuthScope
from oss.src.utils.exceptions import UnauthorizedException
from oss.tests.pytest.utils.principals import envelope_for_claims

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
BUILTIN_PATH = "/gateways/llms/builtin/mock/v1"
STANDARD_PATH = "/gateways/llms/standard/openai/v1"
CUSTOM_PATH = "/gateways/llms/custom/my-connection/v1"

# Test-only header that makes the app authenticate the caller as a session or ApiKey
# principal would: tenant scope on request state, no grants, no audience.
USER_PRINCIPAL_HEADER = "x-test-user-principal"


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


def _envelope_claims() -> dict:
    """The run-envelope claims every Secret carries (M2), for hand-encoded tokens."""
    from oss.src.core.access.principals import envelope_to_claims

    return envelope_to_claims(
        envelope=envelope_for_claims(
            user_id=USER_ID, project_id=PROJECT_ID, organization_id=ORGANIZATION_ID
        )
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
        envelope=envelope_for_claims(
            user_id=USER_ID, project_id=PROJECT_ID, organization_id=ORGANIZATION_ID
        ),
    )
    return f"Secret {token}"


async def _granted_credential_without_run() -> str:
    """What `/access/permissions/check` re-mints for the platform runtime: no run id."""
    token = await auth.sign_secret_token(
        user_id=USER_ID,
        project_id=PROJECT_ID,
        workspace_id=WORKSPACE_ID,
        organization_id=ORGANIZATION_ID,
        grants=[auth.SECRET_RESOLVE_GRANT],
        envelope=envelope_for_claims(
            user_id=USER_ID, project_id=PROJECT_ID, organization_id=ORGANIZATION_ID
        ),
    )
    return f"Secret {token}"


async def _ungranted_credential() -> str:
    """A general Secret token without the grant, as a tenant-hosted service receives."""
    token = await auth.sign_secret_token(
        user_id=USER_ID,
        project_id=PROJECT_ID,
        workspace_id=WORKSPACE_ID,
        organization_id=ORGANIZATION_ID,
        gateway_run_id=RUN_ID,
        envelope=envelope_for_claims(
            user_id=USER_ID, project_id=PROJECT_ID, organization_id=ORGANIZATION_ID
        ),
    )
    return f"Secret {token}"


class _RecordingLlmService:
    """Stands in for the gateway service, so the built-in routes run for real."""

    def __init__(self) -> None:
        self.relay_calls = []
        self.list_models_calls = []

    async def relay_chat_completion(self, *, namespace, name, **_kwargs):
        self.relay_calls.append((namespace, name))

        async def _body():
            yield b"{}"

        return LLMRelayResult(status_code=200, headers={}, body=_body())

    async def list_models(self, *, namespace, name, **_kwargs):
        self.list_models_calls.append((namespace, name))
        return ["gpt-4o"]


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=ORGANIZATION_ID,
        workspace_id=WORKSPACE_ID,
        project_id=PROJECT_ID,
        user_id=USER_ID,
    )


@pytest.fixture(name="llm_service")
def _llm_service():
    return _RecordingLlmService()


@pytest.fixture(name="exchange")
def _exchange(monkeypatch, llm_service):
    """The real exchange and LLM relay routes behind the real auth middleware.

    The client presents a credential; the app authenticates it the way production does and
    the route answers with the credential the sandbox is meant to hold.
    """
    monkeypatch.setattr(credentials_router_module, "get_auth_scope", _scope)
    monkeypatch.setattr(llm_proxy_module, "get_auth_scope", _scope)

    app = FastAPI()

    @app.middleware("http")
    async def _authenticate(request: Request, call_next):
        if request.headers.get(USER_PRINCIPAL_HEADER):
            request.state.project_id = PROJECT_ID
            request.state.run_envelope = envelope_for_claims(
                user_id=USER_ID,
                project_id=PROJECT_ID,
                organization_id=ORGANIZATION_ID,
            )
            return await call_next(request)
        try:
            await auth._check_authentication_token(request)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return await call_next(request)

    app.include_router(GatewayCredentialsRouter().router, prefix="/gateways")
    app.include_router(
        LLMGatewayProxy(llm_gateway_service=llm_service).router,
        prefix="/gateways/llms",
    )

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
            envelope=envelope_for_claims(
                user_id=USER_ID, project_id=PROJECT_ID, organization_id=None
            ),
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
        await auth.sign_secret_token(
            user_id=USER_ID,
            audience="anything-else",
            envelope=envelope_for_claims(
                user_id=USER_ID, project_id=None, organization_id=None
            ),
        )

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


# --- built-in models: only the platform's own agent runs --------------------------------


_OPERATIONS = [
    ("POST", "/chat/completions", {"model": "gpt-4o", "messages": []}),
    ("POST", "/responses", {"model": "gpt-4o", "input": []}),
    ("POST", "/messages", {"model": "claude-3", "messages": [], "max_tokens": 16}),
    ("GET", "/models", None),
]


def _call(client: TestClient, base: str, operation, credentials: dict):
    method, suffix, body = operation
    if method == "GET":
        return client.get(base + suffix, headers=credentials)
    return client.post(base + suffix, headers=credentials, json=body)


def _exchanged(client: TestClient, headers: dict, body=None) -> str:
    response = client.post(EXCHANGE_PATH, headers=headers, json=body or {})
    assert response.status_code == 200, response.text
    return response.json()["credentials"]


def _assert_refused(response) -> None:
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "builtin_requires_agent_run"


@pytest.mark.asyncio
@pytest.mark.parametrize("plane", [None, "llm", "mcp"])
@pytest.mark.parametrize(
    "granted", [_runtime_credential, _granted_credential_without_run]
)
async def test_the_platform_runtime_exchange_marks_the_credential(
    exchange, plane, granted
):
    body = {"plane": plane} if plane else {}

    credentials = _exchanged(exchange, {"Authorization": await granted()}, body)

    claims = _claims(credentials.removeprefix("Secret "))
    assert claims["gateway_platform_run"] is True
    assert claims["aud"] == auth.GATEWAY_TOKEN_AUDIENCE
    assert "grants" not in claims


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {},
        {"plane": "llm"},
        {"plane": "mcp"},
        # Labels are the caller's own words, so they must not buy the mark.
        {"plane": "llm", "session_id": "session-1", "agent_id": "agent-1"},
    ],
)
@pytest.mark.parametrize("caller", ["user_principal", "ungranted_secret"])
async def test_an_exchange_without_the_runtime_grant_never_marks_the_credential(
    exchange, body, caller
):
    if caller == "user_principal":
        headers = {USER_PRINCIPAL_HEADER: "1"}
    else:
        # Carries a signed run id, which is not proof of a platform run either.
        headers = {"Authorization": await _ungranted_credential()}

    credentials = _exchanged(exchange, headers, body)

    assert "gateway_platform_run" not in _claims(credentials.removeprefix("Secret "))


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", _OPERATIONS, ids=lambda op: op[1])
async def test_a_platform_runtime_exchange_reaches_the_built_in_models(
    exchange, llm_service, operation
):
    credentials = _exchanged(exchange, {"Authorization": await _runtime_credential()})

    response = _call(
        exchange, BUILTIN_PATH, operation, {"X-AG-Credentials": credentials}
    )

    assert response.status_code == 200, response.text
    assert len(llm_service.relay_calls) + len(llm_service.list_models_calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", _OPERATIONS, ids=lambda op: op[1])
@pytest.mark.parametrize("caller", ["user_principal", "ungranted_secret"])
async def test_a_user_credential_exchanged_for_a_gateway_token_is_refused_on_built_in(
    exchange, llm_service, operation, caller
):
    """The bypass chain: an API key buys a gateway token, then calls a built-in model."""
    if caller == "user_principal":
        headers = {USER_PRINCIPAL_HEADER: "1"}
    else:
        headers = {"Authorization": await _ungranted_credential()}
    credentials = _exchanged(
        exchange, headers, {"plane": "llm", "session_id": "session-1"}
    )

    response = _call(
        exchange, BUILTIN_PATH, operation, {"X-AG-Credentials": credentials}
    )

    _assert_refused(response)
    assert llm_service.relay_calls == [] and llm_service.list_models_calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", _OPERATIONS, ids=lambda op: op[1])
@pytest.mark.parametrize(
    "caller", ["user_principal", "runtime_credential", "ungranted_secret"]
)
async def test_a_built_in_model_refuses_every_credential_but_the_marked_gateway_token(
    exchange, llm_service, operation, caller
):
    """Even the runtime's own credential must go through the exchange first."""
    if caller == "user_principal":
        headers = {USER_PRINCIPAL_HEADER: "1"}
    elif caller == "runtime_credential":
        headers = {"X-AG-Credentials": await _runtime_credential()}
    else:
        headers = {"X-AG-Credentials": await _ungranted_credential()}

    _assert_refused(_call(exchange, BUILTIN_PATH, operation, headers))
    assert llm_service.relay_calls == [] and llm_service.list_models_calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "claim", ["true", 1, False, None], ids=["string", "int", "false", "null"]
)
async def test_a_mark_that_is_not_exactly_true_is_refused(exchange, claim):
    expiry = datetime.now(timezone.utc) + timedelta(seconds=600)
    token = encode(
        payload={
            "user_id": USER_ID,
            "project_id": PROJECT_ID,
            "organization_id": ORGANIZATION_ID,
            "aud": auth.GATEWAY_TOKEN_AUDIENCE,
            "gateway_platform_run": claim,
            "exp": int(expiry.timestamp()),
            **_envelope_claims(),
        },
        key=SECRET_KEY,
        algorithm="HS256",
    )

    response = _call(
        exchange, BUILTIN_PATH, _OPERATIONS[0], {"X-AG-Credentials": f"Secret {token}"}
    )

    _assert_refused(response)


@pytest.mark.asyncio
async def test_the_mark_on_a_token_without_the_gateway_audience_is_ignored(exchange):
    """A general Secret token with the mark was not minted by `sign_secret_token`."""
    expiry = datetime.now(timezone.utc) + timedelta(seconds=600)
    token = encode(
        payload={
            "user_id": USER_ID,
            "project_id": PROJECT_ID,
            "organization_id": ORGANIZATION_ID,
            "gateway_platform_run": True,
            "exp": int(expiry.timestamp()),
            **_envelope_claims(),
        },
        key=SECRET_KEY,
        algorithm="HS256",
    )
    request = _request(BUILTIN_PATH + "/models", credentials=f"Secret {token}")

    await auth.verify_secret_token(request=request, secret_token=token)

    assert request.state.gateway_platform_run is False


@pytest.mark.asyncio
async def test_only_a_gateway_audience_token_can_be_minted_with_the_mark():
    with pytest.raises(ValueError, match="gateway-audience"):
        await auth.sign_secret_token(
            user_id=USER_ID,
            gateway_platform_run=True,
            envelope=envelope_for_claims(
                user_id=USER_ID, project_id=None, organization_id=None
            ),
        )

    with pytest.raises(ValueError, match="cannot carry grants"):
        await auth.sign_secret_token(
            user_id=USER_ID,
            grants=[auth.SECRET_RESOLVE_GRANT],
            audience=auth.GATEWAY_TOKEN_AUDIENCE,
            gateway_platform_run=True,
            envelope=envelope_for_claims(
                user_id=USER_ID, project_id=None, organization_id=None
            ),
        )


@pytest.mark.asyncio
async def test_the_agenta_mcp_credential_is_refused_on_built_in_models(
    exchange, monkeypatch
):
    """`/gateways/mcps/credentials/agenta` also signs gateway tokens, never with the mark.

    Its caller here carries the runtime grant, so this proves the MCP issuer does not pass
    the grant on as the mark.
    """
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.check_action_access",
        lambda **_kwargs: _allowed(),
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.get_auth_scope", _scope
    )
    runtime = (await _runtime_credential()).removeprefix("Secret ")
    request = _request("/gateways/mcps/credentials/agenta", credentials="unused")
    await auth.verify_secret_token(request=request, secret_token=runtime)
    router = MCPGatewayRouter(
        mcp_gateway_service=None, oauth_connect_service=None, server_probe=None
    )

    issued = await router.issue_agenta_credential(
        request=request, body=MCPAgentaCredentialRequest(tools=[])
    )

    assert "gateway_platform_run" not in _claims(
        issued.credentials.removeprefix("Secret ")
    )
    for operation in _OPERATIONS:
        _assert_refused(
            _call(
                exchange,
                BUILTIN_PATH,
                operation,
                {"X-AG-Credentials": issued.credentials},
            )
        )


async def _allowed() -> bool:
    return True


@pytest.mark.asyncio
@pytest.mark.parametrize("base", [STANDARD_PATH, CUSTOM_PATH])
@pytest.mark.parametrize("operation", _OPERATIONS, ids=lambda op: op[1])
async def test_an_unmarked_gateway_token_still_reaches_own_connection_routes(
    exchange, llm_service, base, operation
):
    credentials = _exchanged(exchange, {USER_PRINCIPAL_HEADER: "1"})

    response = _call(exchange, base, operation, {"X-AG-Credentials": credentials})

    assert response.status_code == 200, response.text
    assert len(llm_service.relay_calls) + len(llm_service.list_models_calls) == 1


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
