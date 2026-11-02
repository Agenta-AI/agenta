"""Every endpoint an SSO issuer's discovery document names passes the egress check."""

import httpx
import pytest

from oss.src.core.auth.supertokens import overrides

ISSUER = "https://idp.test.agenta.ai"
GOOD = {
    "authorization_endpoint": f"{ISSUER}/authorize",
    "token_endpoint": f"{ISSUER}/token",
    "userinfo_endpoint": f"{ISSUER}/userinfo",
    "jwks_uri": f"{ISSUER}/jwks",
}


@pytest.fixture
def discovery(monkeypatch):
    state = {"document": GOOD, "status": 200, "requests": []}

    def handler(request):
        state["requests"].append(request)
        return httpx.Response(state["status"], json=state["document"])

    real_client = httpx.AsyncClient

    def client(**kwargs):
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(overrides.httpx, "AsyncClient", client)

    def check(url):
        if "internal" in url:
            raise ValueError("blocked")
        return "203.0.113.10"

    monkeypatch.setattr(overrides, "resolve_validated_webhook_ip", check)
    return state


@pytest.mark.asyncio
async def test_checked_endpoints_are_returned(discovery):
    endpoints = await overrides._fetch_checked_oidc_endpoints(ISSUER)

    assert endpoints == GOOD
    request = discovery["requests"][0]
    assert request.url.host == "203.0.113.10"
    assert request.headers["host"] == "idp.test.agenta.ai"


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["token_endpoint", "userinfo_endpoint", "jwks_uri"])
async def test_an_endpoint_that_fails_the_check_is_refused(discovery, field):
    discovery["document"] = {**GOOD, field: "https://metadata.internal/token"}

    with pytest.raises(ValueError):
        await overrides._fetch_checked_oidc_endpoints(ISSUER)


@pytest.mark.asyncio
async def test_an_issuer_that_fails_the_check_is_never_fetched(discovery):
    with pytest.raises(ValueError):
        await overrides._fetch_checked_oidc_endpoints("https://idp.internal")
    assert discovery["requests"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "document"),
    [
        (404, GOOD),
        (200, {k: v for k, v in GOOD.items() if k != "token_endpoint"}),
        (200, ["not", "an", "object"]),
    ],
)
async def test_an_unusable_document_gives_no_endpoints(discovery, status, document):
    discovery["status"] = status
    discovery["document"] = document

    assert await overrides._fetch_checked_oidc_endpoints(ISSUER) is None
