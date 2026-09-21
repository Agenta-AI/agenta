"""SSRF gate at registration (D28) — apis/fastapi/gateways/{llms,mcps}/router.py.

**The two routers read two different flags, and that is the subject of half this file.**
The MCP router now asks the gateway's own egress policy
(`core/gateways/egress.py::validate_egress_url_format`, so
`AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED` plus `exempt_hosts()`), because that is the policy
its relay will apply to the very same URL at call time; a save the relay would refuse is not
a save worth accepting. The LLM router still asks the webhook flag
(`AGENTA_INSECURE_EGRESS_ALLOWED` via `validate_url_format_and_literal_ip`) and has the same
disagreement waiting in it, deliberately left for its own change. Its cases below are
therefore written against the webhook flag and the MCP ones against the gateway flag, and
neither set is a template for the other.

Both flags resolve once at import — `_WEBHOOK_ALLOW_INSECURE` as a module constant in
`core/webhooks/utils.py`, and `env.gateway_egress.insecure_allowed` on the shared settings
object — so exporting an env var has no effect on an already-imported process. Every case
here monkeypatches the value directly, mirroring `test_webhooks_utils.py` and
`test_gateways_egress.py`. The repo's autouse `secure_egress_by_default` fixture
(`tests/pytest/utils/egress.py`) pins both closed for the whole suite; this file pins them
again locally so its assertions do not depend on that other fixture being wired up, and a
case that wants one open opens it for itself.

`custom` only — every endpoint this router can create/edit is custom by construction
(no way to express a builtin/agenta identity through these DTOs).
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.gateways.llms.router import LLMGatewayRouter
from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter
from oss.src.utils.context import AuthScope

FIXED_SCOPE = AuthScope(
    organization_id=uuid4(),
    workspace_id=uuid4(),
    project_id=uuid4(),
    user_id=uuid4(),
)


WEBHOOK_FLAG = "oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE"
GATEWAY_FLAG = "oss.src.core.gateways.egress.env.gateway_egress.insecure_allowed"


@pytest.fixture(autouse=True)
def _secure_egress(monkeypatch):
    """The two load-bearing flags: patched directly (not via the env vars — see module
    docstring), explicitly `False` for every test in this file."""
    monkeypatch.setattr(WEBHOOK_FLAG, False, raising=False)
    monkeypatch.setattr(GATEWAY_FLAG, False)


@pytest.fixture(autouse=True)
def _no_exempt_hosts(monkeypatch):
    """No hostname is exempt from the MCP gate while these cases run.

    `exempt_hosts()` reads two operator-environment sources, and a developer who has
    exported the documented self-host values turns the refusals below green for the wrong
    reason — the address under test would have become exempt rather than allowed (D47).
    Cleared here so a refusal means the policy refused; the exemption gets its own case,
    which sets the allowlist itself.
    """
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.mcp_gateway.host_allowlist", []
    )
    monkeypatch.setattr("oss.src.core.gateways.egress.env.mock_gateways.enabled", False)


@pytest.fixture
def no_dns(monkeypatch):
    """Fail the test if anything on the save path resolves a name.

    The no-DNS property is the reason registration calls
    `validate_url_format_and_literal_ip` rather than the resolving boundary: a save-time
    resolve would refuse a hostname that is merely unreachable while the form is being
    submitted, and would settle nothing, since the address a name carries at save time is
    not the address it carries at call time.
    """

    def _fail_if_resolved(*_args, **_kwargs):
        raise AssertionError("no DNS lookup should happen on the save path")

    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo", _fail_if_resolved
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
    router = MCPGatewayRouter(
        mcp_gateway_service=_NullMcpService(),
        oauth_connect_service=None,
        server_probe=None,
    )
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
    router = LLMGatewayRouter(llm_gateway_service=_NullLlmService())
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
            "data": {"route": {"base_url": url}},
        }
    }


# ---------------------------------------------------------------------------
# MCP: create — blocked targets 400 before the mock service is ever called.
# The gateway egress flag is what governs here, and it is closed by the fixture.
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
    assert "endpoint.data.route.base_url" in response.json()["detail"]


def test_mcp_create_endpoint_accepts_a_public_https_hostname_without_dns(
    mcp_client, no_dns
):
    """The whole point of the no-DNS variant: a public https hostname is accepted
    without any resolution attempt. The mock service still 500s past this point
    (it has none of the create fields the real one would validate further), but
    that failure happens AFTER the gate — proving the gate itself let it through."""
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
                "data": {"route": {"base_url": "http://127.0.0.1/mcp"}},
            }
        },
    )

    assert response.status_code == 400
    assert "endpoint.data.route.base_url" in response.json()["detail"]


# ---------------------------------------------------------------------------
# LLM: base_url is optional — the gate is a no-op when it is absent, and
# applies identically to the blocked ranges when it is present.
# ---------------------------------------------------------------------------


def _llm_create_body(base_url, *, deployment_kind="custom") -> dict:
    body = {
        "endpoint": {
            "slug": "acme-llm",
            "provider_key": "openai",
            "deployment_kind": deployment_kind,
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
    """No base_url set (e.g. a deployment_kind that never needed one) — the gate must
    not reject a request that carries nothing for it to check."""
    response = llm_client.post("/endpoints/", json=_llm_create_body(None))

    # Past the gate; the stub service raises next — proves the gate let it through.
    assert response.status_code == 500


@pytest.mark.parametrize(
    ("deployment_kind", "base_url", "expected"),
    [
        ("bedrock", "https://bedrock.example/v1", 400),
        ("vertex_ai", "https://vertex.example/v1/projects/acme", 400),
        ("bedrock", "https://bedrock.example", 500),
        (
            "vertex_ai",
            "https://vertex.example/v1/projects/acme/locations/europe-west4",
            500,
        ),
    ],
)
def test_llm_registration_enforces_cloud_deployment_url_grammar_before_service(
    llm_client, deployment_kind, base_url, expected
):
    response = llm_client.post(
        "/endpoints/",
        json=_llm_create_body(base_url, deployment_kind=deployment_kind),
    )

    assert response.status_code == expected
    if expected == 400:
        assert "endpoint.data.route.base_url" in response.json()["detail"]


# ---------------------------------------------------------------------------
# MCP: which flag decides. One URL, both flags, all four ways round.
# ---------------------------------------------------------------------------

# Plain http AND a private literal address, so it is refused by both halves of the check
# and neither half can carry the result on its own.
_INSECURE_PRIVATE_URL = "http://10.0.0.1/mcp"


@pytest.mark.parametrize(
    ("webhook_open", "gateway_open", "accepted"),
    [
        # Nothing to disagree about: both open, the save goes through.
        (True, True, True),
        # The behaviour change, and the posture a default multi-tenant deployment runs:
        # the webhook flag ships permissive and the gateway flag ships closed. This URL
        # used to be saved here and then refused by every call made to it. It is now
        # refused at the point where someone can still do something about it.
        (True, False, False),
        # The self-hoster who opened the gateway flag, which is what the self-host env
        # templates ship. Their MCP server is on their own network and the relay will
        # dial it, so registration must not be the thing that stops them.
        (False, True, True),
        # Both closed: refused, and for the reason it says.
        (False, False, False),
    ],
)
def test_mcp_registration_follows_the_gateway_flag_not_the_webhook_one(
    mcp_client, monkeypatch, no_dns, webhook_open, gateway_open, accepted
):
    monkeypatch.setattr(WEBHOOK_FLAG, webhook_open, raising=False)
    monkeypatch.setattr(GATEWAY_FLAG, gateway_open)

    response = mcp_client.post(
        "/endpoints/", json=_mcp_create_body(_INSECURE_PRIVATE_URL)
    )

    if accepted:
        # Past the gate; the stub service raises next, which is how "accepted" reads here.
        assert response.status_code == 500
    else:
        assert response.status_code == 400
        assert "endpoint.data.route.base_url" in response.json()["detail"]


def test_mcp_registration_admits_an_allowlisted_host_with_the_gateway_flag_closed(
    mcp_client, monkeypatch, no_dns
):
    """The escape hatch the guard is meant to be used with.

    An operator who has taken responsibility for one internal hostname through
    `AGENTA_MCP_GATEWAY_HOST_ALLOWLIST` can register it without opening the flag globally,
    and the relay exempts the same host for the same reason. Save time and call time agree
    about the exemption too, not only about the flag.
    """
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.mcp_gateway.host_allowlist",
        ["mcp.internal.example"],
    )

    response = mcp_client.post(
        "/endpoints/", json=_mcp_create_body("http://mcp.internal.example:8080/mcp")
    )

    assert response.status_code == 500

    # A host that is not on it stays refused, so the case above is the allowlist working
    # rather than the gate having quietly stopped running.
    other = mcp_client.post(
        "/endpoints/", json=_mcp_create_body("http://mcp.other.example:8080/mcp")
    )

    assert other.status_code == 400


# ---------------------------------------------------------------------------
# Negative control for the LLM plane, which still reads the webhook flag: the
# same private-IP body that 400s above must NOT 400 when that flag is open.
# Proves those rejections come from the flag being pinned False in this file,
# not from a hardcoded 400.
# ---------------------------------------------------------------------------


def test_llm_create_endpoint_accepts_the_same_private_url_when_insecure_allowed(
    llm_client, monkeypatch
):
    monkeypatch.setattr(WEBHOOK_FLAG, True, raising=False)

    response = llm_client.post(
        "/endpoints/", json=_llm_create_body("http://10.0.0.1/v1")
    )

    # Gate let it through (no 400); the stub service raises next.
    assert response.status_code == 500
