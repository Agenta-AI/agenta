"""SSRF gate at registration (D28) — apis/fastapi/gateways/{llms,mcps}/router.py.

`AGENTA_INSECURE_EGRESS_ALLOWED` defaults to `true` (`api/oss/src/utils/env.py`), so a
test that omits it passes while proving nothing. The module-level constant that actually
gates `validate_url_format_and_literal_ip` (`_WEBHOOK_ALLOW_INSECURE` in
`core/webhooks/utils.py`) is resolved once at import time, so setting the env var alone
has no effect on an already-imported process — every test here monkeypatches that
constant directly to `False`, mirroring `test_webhooks_utils.py`'s own technique. The
repo's autouse `secure_egress_by_default` fixture (`tests/pytest/utils/egress.py`) already
does this for the whole suite; this file pins it explicitly and locally so the SSRF
assertion does not depend on that other fixture being wired up.

`custom` only — every endpoint this router can create/edit is custom by construction
(no way to express a builtin/agenta identity through these DTOs).
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.llms.router import LlmGatewayRouter
from oss.src.apis.fastapi.gateways.mcps.router import McpGatewayRouter
from oss.src.utils.context import AuthScope

FIXED_SCOPE = AuthScope(
    organization_id=uuid4(),
    workspace_id=uuid4(),
    project_id=uuid4(),
    user_id=uuid4(),
)


@pytest.fixture(autouse=True)
def _secure_egress(monkeypatch):
    """The load-bearing flag: patched directly (not via the env var — see module
    docstring), explicitly `False` in every test in this file."""
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False, raising=False
    )


class _NullLlmService:
    async def create_endpoint(
        self, **_kwargs
    ):  # pragma: no cover - guarded before call
        raise AssertionError("service must not be called when the SSRF gate rejects")

    edit_endpoint = create_endpoint


class _NullMcpService:
    async def create_endpoint(
        self, **_kwargs
    ):  # pragma: no cover - guarded before call
        raise AssertionError("service must not be called when the SSRF gate rejects")

    edit_endpoint = create_endpoint


@pytest.fixture
def mcp_client(monkeypatch):
    router = McpGatewayRouter(mcp_gateway_service=_NullMcpService())
    app = FastAPI()
    app.include_router(router.router)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.get_auth_scope",
        lambda: FIXED_SCOPE,
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.mcps.router.check_action_access",
        AsyncMock(return_value=True),
    )
    return TestClient(app)


@pytest.fixture
def llm_client(monkeypatch):
    router = LlmGatewayRouter(llm_gateway_service=_NullLlmService())
    app = FastAPI()
    app.include_router(router.router)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.llms.router.get_auth_scope",
        lambda: FIXED_SCOPE,
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.gateways.llms.router.check_action_access",
        AsyncMock(return_value=True),
    )
    return TestClient(app)


def _mcp_create_body(url: str) -> dict:
    return {
        "endpoint": {
            "slug": "acme-mcp",
            "auth_mode": "none",
            "data": {"url": url},
        }
    }


# ---------------------------------------------------------------------------
# MCP: create — blocked targets 400 before the mock service is ever called
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/mcp",  # cloud metadata (link-local)
        "http://127.0.0.1/mcp",  # loopback
        "http://10.0.0.1/mcp",  # RFC-1918 private
        "http://public.example.com/mcp",  # plain http, secure mode requires https
    ],
)
def test_mcp_create_endpoint_rejects_blocked_urls(mcp_client, url):
    response = mcp_client.post("/endpoints/", json=_mcp_create_body(url))

    assert response.status_code == 400
    assert "endpoint.data.url" in response.json()["detail"]


def test_mcp_create_endpoint_accepts_a_public_https_hostname_without_dns(
    mcp_client, monkeypatch
):
    """The whole point of the no-DNS variant: a public https hostname is accepted
    without any resolution attempt. The mock service still 500s past this point
    (it has none of the create fields the real one would validate further), but
    that failure happens AFTER the gate — proving the gate itself let it through."""

    def _fail_if_resolved(*_args, **_kwargs):
        raise AssertionError("no DNS lookup should happen in the no-DNS variant")

    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo", _fail_if_resolved
    )

    response = mcp_client.post(
        "/endpoints/", json=_mcp_create_body("https://mcp.public.example.com/notion")
    )

    # The gate passed (no 400, no DNS lookup); the stub service then raises,
    # which intercept_exceptions turns into a 500 — not the gate's concern.
    assert response.status_code == 500


# ---------------------------------------------------------------------------
# MCP: edit — same gate, same blocked targets
# ---------------------------------------------------------------------------


def test_mcp_edit_endpoint_rejects_a_blocked_url(mcp_client):
    endpoint_id = "00000000-0000-0000-0000-000000000001"

    response = mcp_client.put(
        f"/endpoints/{endpoint_id}",
        json={
            "endpoint": {
                "id": endpoint_id,
                "auth_mode": "none",
                "data": {"url": "http://127.0.0.1/mcp"},
            }
        },
    )

    assert response.status_code == 400
    assert "endpoint.data.url" in response.json()["detail"]


# ---------------------------------------------------------------------------
# LLM: base_url is optional — the gate is a no-op when it is absent, and
# applies identically to the blocked ranges when it is present.
# ---------------------------------------------------------------------------


def _llm_create_body(base_url) -> dict:
    body = {
        "endpoint": {
            "slug": "acme-llm",
            "provider_key": "openai",
            "deployment": "custom",
            "data": {"route": {}},
        }
    }
    if base_url is not None:
        body["endpoint"]["data"]["route"]["base_url"] = base_url
    return body


@pytest.mark.parametrize(
    "base_url",
    [
        "http://169.254.169.254/v1",
        "http://127.0.0.1/v1",
        "http://10.0.0.1/v1",
        "http://public.example.com/v1",
    ],
)
def test_llm_create_endpoint_rejects_blocked_base_urls(llm_client, base_url):
    response = llm_client.post("/endpoints/", json=_llm_create_body(base_url))

    assert response.status_code == 400
    assert "endpoint.data.route.base_url" in response.json()["detail"]


def test_llm_create_endpoint_is_a_noop_when_base_url_absent(llm_client):
    """No base_url set (e.g. a deployment that never needed one) — the gate must
    not reject a request that carries nothing for it to check."""
    response = llm_client.post("/endpoints/", json=_llm_create_body(None))

    # Past the gate; the stub service raises next — proves the gate let it through.
    assert response.status_code == 500


# ---------------------------------------------------------------------------
# Negative control: the same private-IP body that 400s above must NOT 400
# when the flag is (as it defaults) permissive. Proves the rejections above
# come from the flag being pinned False in this file, not a hardcoded 400.
# ---------------------------------------------------------------------------


def test_mcp_create_endpoint_accepts_the_same_private_url_when_insecure_allowed(
    mcp_client, monkeypatch
):
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", True, raising=False
    )

    response = mcp_client.post(
        "/endpoints/", json=_mcp_create_body("http://127.0.0.1/mcp")
    )

    # Gate let it through (no 400); the stub service raises next.
    assert response.status_code == 500
