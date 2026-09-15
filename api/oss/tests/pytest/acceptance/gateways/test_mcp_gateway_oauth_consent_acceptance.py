"""The MCP OAuth consent flow, end to end, over real sockets.

`test_mcp_gateway_oauth_acceptance.py` beside this file seeds an `oauth_grant` secret by
hand and proves the relay reads it from the vault. It never runs a consent flow, and until
the mock MCP container grew an OAuth issuer (`core/gateways/mcps/providers/mock/issuer.py`)
nothing could: the mock answered every request `200`, published no metadata, and the
integration suite drove the client through an in-process httpx transport no browser can
reach. So discovery, the authorization redirect, the token exchange and the PKCE check had
never run against a socket at all.

What each test here crosses:

* the **API**, for every management and data-plane call, as a browser does — the callback
  is exempt from `auth_middleware` and resolves its own principal from the SuperTokens
  session, so these tests hold a real session rather than an API key for it;
* the **mock issuer**, for the browser leg, dialled on the port the compose stack
  publishes, because the authorize URL the gateway mints names the private Docker address
  the gateway itself dials;
* the **mock MCP server**, for the final `tools/call`, on the OAuth-protected path that
  answers `401` to anyone without a bearer it issued.

Gated on `AGENTA_GATEWAYS_MOCKS_ENABLED` like its siblings. With the flag on, an absent
issuer fails these tests rather than skipping them: nothing here is conditional on the
issuer answering.
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
import uuid
from typing import Any, Dict, Iterator
from urllib.parse import parse_qs, urlparse

import pytest
import requests

BASE_TIMEOUT = 60

_MOCKS_ENABLED = os.getenv("AGENTA_GATEWAYS_MOCKS_ENABLED", "").lower() == "true"

# The address the API dials, and therefore the address the issuer publishes itself under.
_MCP_MOCK_URL = os.getenv(
    "AGENTA_MOCK_MCP_GATEWAY_URL", "http://mock-mcp-gateway:9092"
).rstrip("/")

# The same container as seen from the host, which is where a browser — and this test —
# stands. The dev compose files publish the mock on this port.
_PUBLISHED_MOCK_URL = os.getenv(
    "AGENTA_MOCK_MCP_GATEWAY_PUBLISHED_URL", "http://localhost:9092"
).rstrip("/")

# The OAuth-protected MCP surface. `/` stays unauthenticated for every other suite.
_OAUTH_MCP_PATH = "/oauth/mcp"
_OAUTH_MCP_URL = f"{_MCP_MOCK_URL}{_OAUTH_MCP_PATH}"

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.skipif(
        not _MOCKS_ENABLED,
        reason="gateway mock matrix is disabled (set AGENTA_GATEWAYS_MOCKS_ENABLED=true)",
    ),
]


def _assert_ok(response: requests.Response) -> Dict[str, Any]:
    assert response.status_code == 200, response.text
    return response.json()


def _on_host(url: str) -> str:
    """Rewrite a URL the gateway minted for itself into one this process can dial."""
    assert url.startswith(_MCP_MOCK_URL), url
    return _PUBLISHED_MOCK_URL + url[len(_MCP_MOCK_URL) :]


_CALLBACK_PATH = "/gateways/mcps/connect/callback"


def _on_api_host(browser: "_Browser", url: str) -> str:
    """Check the callback the gateway minted, then dial it where this process can.

    The gateway builds its `redirect_uri` from `AGENTA_API_URL`, the address it is reached
    at publicly, which is not necessarily the address this process drives: a stack behind a
    tunnel answers on both. Asserting the route rather than the host keeps the check honest
    without pinning the suite to one of the two, the same bargain `_on_host` strikes for the
    mock.
    """
    parsed = urlparse(url)
    assert parsed.path.endswith(_CALLBACK_PATH), url
    return f"{browser.api_url}{_CALLBACK_PATH}?{parsed.query}"


def _is_loopback(url: str) -> bool:
    return (urlparse(url).hostname or "").lower() in ("127.0.0.1", "localhost", "::1")


def _trust_session_cookies_over_loopback(session: requests.Session) -> None:
    """Let a `Secure` session cookie travel to a loopback address, as a browser does.

    SuperTokens marks its session cookie `Secure` whenever `AGENTA_API_URL` is https —
    `core/auth/supertokens/config.py` derives `api_domain` from it — which is the case on
    any stack fronted by a tunnel. `http.cookiejar` then refuses to send that cookie over
    plain http, so this suite could not hold a session against the stack's own direct
    address even though it is the same stack: the API key request answered `401` and every
    test here errored in the fixture before reaching the mock.

    Browsers treat `127.0.0.1` and `localhost` as secure contexts and do send the cookie
    there, so clearing the flag for loopback restores the behaviour the suite models rather
    than weakening it. Setting the jar's policy would not work: `requests` rebuilds the jar
    for each request and the replacement carries the default policy, so the flag has to come
    off the stored cookie itself.
    """
    for cookie in session.cookies:
        cookie.secure = False


class _Browser:
    """One signed-in browser: a SuperTokens session, plus that user's own API key.

    Both are needed and neither substitutes for the other. The management routes and the
    OAuth callback want the session — the callback refuses a browser with no Agenta
    session, which is the whole point of `resolve_session_user_id`. The data plane reads
    `X-AG-Credentials` and nothing else (D31), so the relay call carries the API key.

    The account is created through `/auth/signup` rather than through the admin fixtures in
    `utils/accounts.py`, and that is deliberate. Those fixtures mint an account with an API
    key and no password, and an API key cannot stand in here: the callback names its caller
    through `resolve_session_user_id`, which reads the session cookie alone, and
    `MCPOAuthConnectService.claim` refuses a caller of `None`. A session is the one
    credential this flow cannot do without.
    """

    def __init__(self, *, api_url: str) -> None:
        self.api_url = api_url.rstrip("/")
        self.session = requests.Session()
        self.email = f"mcp-oauth-{uuid.uuid4().hex[:12]}@test.agenta.ai"

        signup = self.session.post(
            f"{self.api_url}/auth/signup",
            # SuperTokens hands back header tokens unless the caller asks for cookies,
            # and the callback is a top-level navigation that can only carry cookies.
            headers={"st-auth-mode": "cookie"},
            json={
                "formFields": [
                    {"id": "email", "value": self.email},
                    {"id": "password", "value": "Acceptance123!"},
                ]
            },
            timeout=BASE_TIMEOUT,
        )
        assert signup.status_code == 200, (
            "email/password signup is required to hold a browser session for the OAuth "
            f"callback: {signup.status_code} {signup.text}"
        )
        assert "sAccessToken" in self.session.cookies, signup.headers
        if _is_loopback(self.api_url):
            _trust_session_cookies_over_loopback(self.session)

        key = self.session.post(f"{self.api_url}/keys/", timeout=BASE_TIMEOUT)
        assert key.status_code == 200, key.text
        self.credentials = f"ApiKey {key.json()}"

    def api(self, method: str, path: str, **kwargs) -> requests.Response:
        return self.session.request(
            method=method,
            url=f"{self.api_url}{path}",
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    def relay(self, path: str, payload: Dict[str, Any]) -> requests.Response:
        return self.session.post(
            f"{self.api_url}{path}",
            headers={"X-AG-Credentials": self.credentials},
            json=payload,
            timeout=BASE_TIMEOUT,
        )


@pytest.fixture(scope="module")
def browser(ag_env) -> Iterator[_Browser]:
    yield _Browser(api_url=ag_env["api_url"])


@pytest.fixture
def oauth_endpoint(browser: _Browser) -> Iterator[Dict[str, Any]]:
    """A custom MCP endpoint pointing at the mock's OAuth-protected surface."""
    slug = f"oauth-consent-{uuid.uuid4().hex[:8]}"
    endpoint = _assert_ok(
        browser.api(
            "POST",
            "/gateways/mcps/endpoints/",
            json={
                "endpoint": {
                    "slug": slug,
                    "auth_mode": "oauth",
                    "data": {"route": {"base_url": _OAUTH_MCP_URL}},
                }
            },
        )
    )["endpoint"]
    try:
        yield endpoint
    finally:
        browser.api("DELETE", f"/gateways/mcps/endpoints/{endpoint['id']}")


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
        .decode("ascii")
        .rstrip("=")
    )
    return verifier, challenge


def _begin(browser: _Browser, endpoint: Dict[str, Any], scopes: list[str]) -> str:
    started = _assert_ok(
        browser.api(
            "POST",
            f"/gateways/mcps/endpoints/{endpoint['id']}/connect",
            json={"scopes": scopes},
        )
    )
    return started["redirect_url"]


@pytest.mark.acceptance
def test_the_mock_mcp_server_challenges_a_caller_with_no_bearer(browser: _Browser):
    """RFC 9728 s3: the `401` names where discovery starts, and that document resolves."""
    probe = requests.get(
        f"{_PUBLISHED_MOCK_URL}{_OAUTH_MCP_PATH}", timeout=BASE_TIMEOUT
    )
    assert probe.status_code == 401, probe.text
    challenge = probe.headers.get("WWW-Authenticate", "")
    assert "resource_metadata=" in challenge, challenge

    metadata_url = challenge.split('resource_metadata="', 1)[1].split('"', 1)[0]
    document = _assert_ok(requests.get(_on_host(metadata_url), timeout=BASE_TIMEOUT))
    assert document["authorization_servers"] == [_MCP_MOCK_URL]
    assert document["scopes_supported"]

    # The unauthenticated mock every other suite speaks to is untouched.
    unauthenticated = requests.post(
        f"{_PUBLISHED_MOCK_URL}/",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        timeout=BASE_TIMEOUT,
    )
    assert unauthenticated.status_code == 200, unauthenticated.text


@pytest.mark.acceptance
def test_the_consent_flow_issues_a_grant_the_relay_presents_to_the_mock_server(
    browser: _Browser, oauth_endpoint: Dict[str, Any]
):
    """Discover, consent, exchange, relay — every leg over a socket."""
    slug = oauth_endpoint["slug"]

    # Nothing is connected yet, so the relay has no grant to present and refuses. Without
    # this the final `tools/call` would prove only that the mock answers.
    ungranted = browser.relay(
        f"/gateways/mcps/custom/{slug}",
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
    )
    assert ungranted.status_code != 200, ungranted.text

    # Step one of the connect route: discover, and cache the scope checklist on the row.
    discovered = _assert_ok(
        browser.api(
            "POST", f"/gateways/mcps/endpoints/{oauth_endpoint['id']}/connect", json={}
        )
    )
    scopes = discovered["scopes_offered"]
    assert scopes, discovered

    # Step two: begin, which records the attempt and mints the authorization URL.
    redirect_url = _begin(browser, oauth_endpoint, scopes)
    query = parse_qs(urlparse(redirect_url).query)
    assert redirect_url.startswith(f"{_MCP_MOCK_URL}/oauth/authorize"), redirect_url
    assert query["code_challenge_method"] == ["S256"]
    assert query["code_challenge"][0]
    assert query["state"][0]

    # The browser leg: the issuer redirects straight back to the callback with a code.
    authorized = requests.get(
        _on_host(redirect_url), allow_redirects=False, timeout=BASE_TIMEOUT
    )
    assert authorized.status_code == 302, authorized.text
    callback_url = authorized.headers["location"]
    assert parse_qs(urlparse(callback_url).query)["state"] == query["state"]

    # The callback: claim the attempt, exchange the code, write the grant.
    callback = browser.session.get(
        _on_api_host(browser, callback_url), timeout=BASE_TIMEOUT
    )
    assert callback.status_code == 200, callback.text
    assert '"success": true' in callback.text

    connected = _assert_ok(
        browser.api("GET", f"/gateways/mcps/endpoints/{oauth_endpoint['id']}")
    )["endpoint"]
    assert connected["secret_id"], connected
    # The grant is a vault handle on the row and nothing more.
    assert "access_token" not in callback.text
    assert "access_token" not in str(connected)

    # And the relay now reaches a surface that refuses every caller without a bearer the
    # issuer minted, so a `200` here is that bearer arriving.
    called = _assert_ok(
        browser.relay(
            f"/gateways/mcps/custom/{slug}",
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "echo", "arguments": {"text": "consented"}},
            },
        )
    )
    assert "consented" in str(called["result"]), called


@pytest.mark.acceptance
def test_a_code_bound_to_another_pkce_challenge_is_refused(
    browser: _Browser, oauth_endpoint: Dict[str, Any]
):
    """The branch the rework of PKCE handling has to survive.

    The gateway keeps its verifier server-side in the authorization attempt, so a wrong
    verifier cannot be posted at it directly. A code minted against a DIFFERENT challenge
    is the same defect seen from the other end: the gateway presents its own verifier, the
    issuer recomputes the hash, and the exchange must fail. Were PKCE unchecked anywhere
    along that path, this would connect.
    """
    _assert_ok(
        browser.api(
            "POST", f"/gateways/mcps/endpoints/{oauth_endpoint['id']}/connect", json={}
        )
    )
    redirect_url = _begin(browser, oauth_endpoint, ["tools:call"])
    query = parse_qs(urlparse(redirect_url).query)

    # The issuer refuses a mismatched verifier outright. Pinned first, because every
    # assertion below is worthless if the mock takes any verifier at all.
    verifier, challenge = _pkce_pair()
    authorize = f"{_PUBLISHED_MOCK_URL}/oauth/authorize"
    token_endpoint = f"{_PUBLISHED_MOCK_URL}/oauth/token"
    redirect_uri = query["redirect_uri"][0]

    def _mint_code(code_challenge: str, state: str) -> str:
        minted = requests.get(
            authorize,
            params={
                "response_type": "code",
                "client_id": query["client_id"][0],
                "redirect_uri": redirect_uri,
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "scope": "tools:call",
            },
            allow_redirects=False,
            timeout=BASE_TIMEOUT,
        )
        assert minted.status_code == 302, minted.text
        return parse_qs(urlparse(minted.headers["location"]).query)["code"][0]

    refused = requests.post(
        token_endpoint,
        data={
            "grant_type": "authorization_code",
            "code": _mint_code(challenge, "direct"),
            "redirect_uri": redirect_uri,
            "client_id": query["client_id"][0],
            "code_verifier": f"not-{verifier}",
        },
        timeout=BASE_TIMEOUT,
    )
    assert refused.status_code == 400, refused.text
    assert refused.json()["error"] == "invalid_grant", refused.text

    accepted = requests.post(
        token_endpoint,
        data={
            "grant_type": "authorization_code",
            "code": _mint_code(challenge, "direct"),
            "redirect_uri": redirect_uri,
            "client_id": query["client_id"][0],
            "code_verifier": verifier,
        },
        timeout=BASE_TIMEOUT,
    )
    assert accepted.status_code == 200, accepted.text

    # Now the same defect through the API: a code bound to our challenge, handed to the
    # callback of an attempt that holds the gateway's own verifier.
    foreign_code = _mint_code(challenge, query["state"][0])
    callback = browser.session.get(
        f"{browser.api_url}/gateways/mcps/connect/callback",
        params={"code": foreign_code, "state": query["state"][0]},
        timeout=BASE_TIMEOUT,
    )
    assert callback.status_code == 400, callback.text
    assert '"success": false' in callback.text

    still_unconnected = _assert_ok(
        browser.api("GET", f"/gateways/mcps/endpoints/{oauth_endpoint['id']}")
    )["endpoint"]
    assert not still_unconnected.get("secret_id"), still_unconnected


@pytest.mark.acceptance
def test_the_probe_reads_a_url_before_any_endpoint_exists(browser: _Browser):
    """The connect journey asks for a URL first, so the probe has to answer without a row.

    Both mock surfaces are used, because the two answers are what the journey branches on:
    `/` takes anyone and names itself in the handshake, while `/oauth/mcp` refuses the
    anonymous handshake and publishes where to authorize. Neither call may create an
    endpoint, and the count afterwards proves it.
    """
    before = _assert_ok(browser.api("GET", "/gateways/mcps/endpoints/"))["count"]

    open_server = _assert_ok(
        browser.api(
            "POST",
            "/gateways/mcps/endpoints/probe",
            json={"url": f"{_MCP_MOCK_URL}/"},
        )
    )["probe"]
    assert open_server["reachable"] is True
    assert open_server["auth"]["mode"] == "none"
    # The name the journey offers before anyone types one.
    assert open_server["server_name"] == "agenta-mock-mcp"
    assert open_server["protocol_version"]

    protected = _assert_ok(
        browser.api(
            "POST",
            "/gateways/mcps/endpoints/probe",
            json={"url": _OAUTH_MCP_URL},
        )
    )["probe"]
    assert protected["reachable"] is True
    assert protected["auth"]["mode"] == "oauth"
    assert protected["auth"]["authorization_server"] == _MCP_MOCK_URL
    assert protected["auth"]["scopes_offered"] == ["tools:list", "tools:call"]
    # A protected server tells the probe nothing about itself until consent, and the
    # journey falls back to the hostname rather than inventing a name.
    assert protected.get("server_name") is None

    after = _assert_ok(browser.api("GET", "/gateways/mcps/endpoints/"))["count"]
    assert after == before


@pytest.mark.acceptance
def test_the_probe_refuses_a_url_the_gateway_would_refuse(browser: _Browser):
    """The address checks a create runs are the ones the first step runs.

    Only the checks that hold on every deployment are asserted here. Whether `http` and
    `localhost` are refused depends on `AGENTA_INSECURE_EGRESS_ALLOWED`, which a
    development stack leaves on; those cases are pinned in the unit suite with the flag
    explicitly off.
    """
    for url in ("https://user:pw@mcp.example.com/", "ftp://mcp.example.com/", ""):
        response = browser.api(
            "POST", "/gateways/mcps/endpoints/probe", json={"url": url}
        )
        assert response.status_code == 400, f"{url!r}: {response.text}"
