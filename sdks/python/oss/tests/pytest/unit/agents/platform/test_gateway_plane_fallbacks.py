"""What the SDK does when the API says it does not serve a gateway plane.

The API owns both switches (`AGENTA_LLM_GATEWAY_ENABLED`, `AGENTA_MCP_GATEWAY_ENABLED`);
the SDK carries none of its own. It learns a plane is off from the typed refusal, and takes
the path it used before that gateway existed — reading the project's vault key for a model,
dialling a declared MCP server directly — so a deployment with the plane off runs exactly as
it did on the release before this one.

The two fallbacks are deliberately narrow. Only `llm_gateway_disabled` and a 404 from an API
too old to have the route send the LLM resolver to the vault; only `mcp_gateway_disabled`
sends MCP resolution to the direct dial. Every other refusal is about the request itself and
stays a failed run, because taking a different path would answer a question nobody asked.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import pytest

from agenta.sdk.agents.connections import (
    ConnectionResolutionError,
    GatewayConnectionRefusedError,
    ModelRef,
    RuntimeAuthContext,
)
from agenta.sdk.agents.platform import (
    PlatformConnection,
    VaultConnectionResolver,
    resolve_mcp,
)
from agenta.sdk.agents.platform import connection as platform_connection
from agenta.sdk.agents.platform import connections

RESOLVE_PATH = "/gateways/llms/resolve"
SECRETS_PATH = "/secrets/"
CREDENTIALS_PATH = "/gateways/credentials"

VAULT_KEY = "sk-from-the-vault"


def _envelope(code: str, message: str = "off") -> Dict[str, Any]:
    """A refusal shaped the way `apis/fastapi/gateways/exceptions.py` sends one."""
    return {
        "detail": {
            "code": code,
            "message": message,
            "retryable": False,
            "details": {"flag": "AGENTA_LLM_GATEWAY_ENABLED"},
        }
    }


class _Response:
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> Any:
        return self._payload


class _Routes:
    """An httpx stand-in that answers per path, and records what it was asked.

    The shared `fake_http` fixture answers one response for every URL, which cannot express
    the case under test here: a refusal on one route and a success on another.
    """

    def __init__(self, responses: Dict[str, _Response]) -> None:
        self.responses = responses
        self.calls: List[Dict[str, Any]] = []

    def install(self, monkeypatch, *modules) -> "_Routes":
        for module in modules:
            monkeypatch.setattr(module.httpx, "AsyncClient", self._client())
        return self

    def paths(self) -> List[str]:
        return [call["path"] for call in self.calls]

    def _answer(self, method: str, url: str, body: Any, headers: Any) -> _Response:
        for path, response in self.responses.items():
            if url.endswith(path):
                self.calls.append(
                    {"method": method, "path": path, "json": body, "headers": headers}
                )
                return response
        raise AssertionError(f"unexpected request: {method} {url}")

    def _client(self):
        routes = self

        class _Client:
            def __init__(self, *args, **kwargs) -> None:
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, url, json=None, headers=None):
                return routes._answer("POST", url, json, headers)

            async def get(self, url, headers=None):
                return routes._answer("GET", url, None, headers)

        return _Client


def _vault() -> List[Dict[str, Any]]:
    """One ordinary provider key, the record the pre-gateway path resolved from."""
    return [
        {
            "slug": "openai",
            "kind": "provider_key",
            "header": {"name": "openai"},
            "data": {"kind": "openai", "provider": {"key": VAULT_KEY}},
        }
    ]


def _model(slug: Optional[str] = "openai") -> ModelRef:
    connection: Dict[str, Any] = {"mode": "agenta"}
    if slug is not None:
        connection["slug"] = slug
    return ModelRef(provider="openai", model="gpt-5.5", connection=connection)


def _context() -> RuntimeAuthContext:
    return RuntimeAuthContext(harness="pi_core", backend="local")


@pytest.fixture
def platform() -> PlatformConnection:
    return PlatformConnection(base_url="https://api.x/api", authorization="Access tok")


# ---------------------------------------------------------------------------
# The LLM plane: back to the vault key
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "refusal",
    [
        pytest.param(
            _Response(403, _envelope("llm_gateway_disabled")),
            id="the plane is switched off",
        ),
        pytest.param(
            _Response(404, {"detail": "Not Found"}),
            id="an API too old to have the route",
        ),
    ],
)
async def test_a_refused_llm_plane_resolves_the_model_from_the_vault(
    refusal, platform, monkeypatch
):
    routes = _Routes(
        {RESOLVE_PATH: refusal, SECRETS_PATH: _Response(200, _vault())}
    ).install(monkeypatch, connections, platform_connection)

    resolved = await VaultConnectionResolver(platform).resolve(
        model=_model(), context=_context()
    )

    # The pre-gateway contract: the provider key itself travels into the sandbox, and no
    # gateway route is built.
    assert resolved.credential_mode == "env"
    assert {item.value for item in resolved.credentials} == {VAULT_KEY}
    assert resolved.gateway_credentials is None
    assert routes.paths() == [RESOLVE_PATH, SECRETS_PATH]


async def test_the_vault_fallback_reads_with_the_caller_own_credential(
    platform, monkeypatch
):
    routes = _Routes(
        {
            RESOLVE_PATH: _Response(403, _envelope("llm_gateway_disabled")),
            SECRETS_PATH: _Response(200, _vault()),
        }
    ).install(monkeypatch, connections, platform_connection)

    await VaultConnectionResolver(platform).resolve(model=_model(), context=_context())

    secrets_call = routes.calls[-1]
    assert secrets_call["method"] == "GET"
    assert secrets_call["headers"]["Authorization"] == "Access tok"


async def test_no_gateway_credential_is_minted_for_a_plane_that_is_off(
    platform, monkeypatch
):
    # The exchange exists to confine a sandbox to the gateway. With no gateway in the run
    # there is nothing to confine it to, and paying for the round trip would be waste.
    routes = _Routes(
        {
            RESOLVE_PATH: _Response(403, _envelope("llm_gateway_disabled")),
            SECRETS_PATH: _Response(200, _vault()),
        }
    ).install(monkeypatch, connections, platform_connection)

    await VaultConnectionResolver(platform).resolve(model=_model(), context=_context())

    assert CREDENTIALS_PATH not in routes.paths()


@pytest.mark.parametrize(
    "status, body",
    [
        (403, _envelope("policy_denied", "no permission")),
        (404, _envelope("endpoint_not_found", "no such endpoint")),
        (404, {"detail": "LLM endpoint not found: custom/absent"}),
        (409, _envelope("secret_missing", "no secret")),
        (422, _envelope("gateway_provider_required", "name a provider")),
    ],
)
async def test_any_other_refusal_still_fails_the_run(
    status, body, platform, monkeypatch
):
    # A 404 that names a code is the gateway answering, not an API without the route: an
    # endpoint that does not exist must not be answered by silently using a vault key.
    routes = _Routes(
        {
            RESOLVE_PATH: _Response(status, body),
            SECRETS_PATH: _Response(200, _vault()),
        }
    ).install(monkeypatch, connections, platform_connection)

    with pytest.raises(GatewayConnectionRefusedError):
        await VaultConnectionResolver(platform).resolve(
            model=_model(), context=_context()
        )

    assert routes.paths() == [RESOLVE_PATH]


async def test_a_failing_vault_read_on_the_fallback_path_is_reported_as_itself(
    platform, monkeypatch
):
    _Routes(
        {
            RESOLVE_PATH: _Response(403, _envelope("llm_gateway_disabled")),
            SECRETS_PATH: _Response(500, {"detail": "boom"}),
        }
    ).install(monkeypatch, connections, platform_connection)

    with pytest.raises(ConnectionResolutionError, match="HTTP 500"):
        await VaultConnectionResolver(platform).resolve(
            model=_model(), context=_context()
        )


# ---------------------------------------------------------------------------
# The MCP plane: back to the direct dial
# ---------------------------------------------------------------------------


class _EmptySecrets:
    async def get_many(self, names):
        return {}


def _server() -> Dict[str, Any]:
    return {
        "name": "notion",
        "connection": {"type": "http", "url": "https://93.184.216.34/mcp"},
    }


async def test_a_refused_mcp_plane_dials_the_declared_server_directly(
    platform, monkeypatch
):
    routes = _Routes(
        {CREDENTIALS_PATH: _Response(403, _envelope("mcp_gateway_disabled"))}
    ).install(monkeypatch, platform_connection)

    resolved = await resolve_mcp(
        [_server()], secret_provider=_EmptySecrets(), connection=platform
    )

    assert len(resolved) == 1
    assert resolved[0].url == "https://93.184.216.34/mcp"
    assert resolved[0].credentials == []
    assert routes.paths() == [CREDENTIALS_PATH]


async def test_the_credential_exchange_names_the_plane_it_is_for(platform, monkeypatch):
    # Naming the plane is the only reason this refusal can arrive before the run starts
    # rather than at the first tool call.
    routes = _Routes(
        {CREDENTIALS_PATH: _Response(200, {"credentials": "Secret gw"})}
    ).install(monkeypatch, platform_connection)

    await resolve_mcp([_server()], secret_provider=_EmptySecrets(), connection=platform)

    assert routes.calls[0]["json"] == {"plane": "mcp"}


async def test_a_serving_mcp_plane_still_routes_through_the_gateway(
    platform, monkeypatch
):
    _Routes({CREDENTIALS_PATH: _Response(200, {"credentials": "Secret gw"})}).install(
        monkeypatch, platform_connection
    )

    resolved = await resolve_mcp(
        [_server()], secret_provider=_EmptySecrets(), connection=platform
    )

    assert resolved[0].url == "https://api.x/api/gateways/mcps/custom/notion"
    assert [item.value for item in resolved[0].credentials] == ["Secret gw"]


@pytest.mark.parametrize("status", [401, 403, 500])
async def test_any_other_refused_exchange_still_fails_the_run(
    status, platform, monkeypatch
):
    # A credential the gateway would not issue is a broken run, not a reason to dial an
    # author's server with whatever named secrets happen to be lying about.
    _Routes(
        {CREDENTIALS_PATH: _Response(status, _envelope("policy_denied", "denied"))}
    ).install(monkeypatch, platform_connection)

    with pytest.raises(platform_connection.GatewayCredentialsError):
        await resolve_mcp(
            [_server()], secret_provider=_EmptySecrets(), connection=platform
        )
