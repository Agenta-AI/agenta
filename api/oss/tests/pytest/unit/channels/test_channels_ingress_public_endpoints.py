"""The channels ingress owns one _PUBLIC_ENDPOINTS addition, and the hosted
Slack app owns a second, narrower one: only the callback (Slack redirects
the browser here with no Agenta session) is public. The install route stays
authenticated -- it is the one that mints the state in the first place.

This is the guard against a future wildcard undoing either.

The middleware matches `request.url.path.startswith(_PUBLIC_ENDPOINTS)` --
a literal-prefix test. If someone later "simplifies" the four ingress
entries into a bare "/channels/" prefix, this test catches it: a config
route under /channels/ must still require auth.

`_check_authentication_token` is exercised directly (no running app/DB
needed) -- it is the function `auth_middleware` calls before anything else,
and the one that consults _PUBLIC_ENDPOINTS.
"""

import pytest
from fastapi import Request

from oss.src.middlewares.auth import _PUBLIC_ENDPOINTS, _check_authentication_token
from oss.src.utils.exceptions import UnauthorizedException


def _make_request(path: str) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "headers": [],
        "query_string": b"",
        "client": ("test", 0),
        "server": ("test", 80),
    }
    return Request(scope)


# ---------------------------------------------------------------------------
# The four ingress entries must be present, per channel shipped.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/channels/slack/events/",
        "/api/channels/slack/events/",
        "/preview/channels/slack/events/",
        "/api/preview/channels/slack/events/",
        "/channels/bridge/events/",
        "/api/channels/bridge/events/",
        "/preview/channels/bridge/events/",
        "/api/preview/channels/bridge/events/",
        "/channels/agenta/events/",
        "/api/channels/agenta/events/",
        "/preview/channels/agenta/events/",
        "/api/preview/channels/agenta/events/",
        "/channels/catalog/channels/slack/callback/",
        "/api/channels/catalog/channels/slack/callback/",
        "/preview/channels/catalog/channels/slack/callback/",
        "/api/preview/channels/catalog/channels/slack/callback/",
    ],
)
def test_ingress_paths_are_public(path):
    assert path in _PUBLIC_ENDPOINTS


@pytest.mark.parametrize(
    "path",
    [
        "/channels/slack/events/",
        "/api/channels/slack/events/",
        "/preview/channels/slack/events/",
        "/api/preview/channels/slack/events/",
        "/channels/bridge/events/",
        "/api/channels/bridge/events/",
        "/preview/channels/bridge/events/",
        "/api/preview/channels/bridge/events/",
        "/channels/agenta/events/",
        "/api/channels/agenta/events/",
        "/preview/channels/agenta/events/",
        "/api/preview/channels/agenta/events/",
        "/channels/catalog/channels/slack/callback/",
        "/api/channels/catalog/channels/slack/callback/",
        "/preview/channels/catalog/channels/slack/callback/",
        "/api/preview/channels/catalog/channels/slack/callback/",
    ],
)
async def test_ingress_paths_reach_the_handler_with_no_auth(path):
    request = _make_request(path)

    # Must not raise -- this is what makes the route reachable with no
    # Authorization header and no session cookie.
    result = await _check_authentication_token(request)
    assert result is None


# ---------------------------------------------------------------------------
# The guard: config routes under /channels/ are NOT public. Widening the
# ingress prefix is what could break this -- this proves it did not.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/channels/agents/",
        "/channels/spaces/",
        "/channels/grants/",
        "/channels/catalog/",
        "/channels/catalog/slack/capabilities/",
        "/channels/connections/query",
        "/channels/policy/resolve",
        "/channels/threads/query",
        "/channels/inbox/events/query",
        "/channels/outbox/events/query",
        "/api/channels/agents/",
        "/preview/channels/agents/",
        "/api/preview/channels/agents/",
        # The install route mints the state -- it must stay authenticated;
        # only the callback it redirects to is public.
        "/channels/catalog/channels/slack/install/",
        "/api/channels/catalog/channels/slack/install/",
        "/preview/channels/catalog/channels/slack/install/",
        "/api/preview/channels/catalog/channels/slack/install/",
    ],
)
async def test_config_routes_under_channels_are_not_public(path):
    request = _make_request(path)

    with pytest.raises(UnauthorizedException):
        await _check_authentication_token(request)


def test_bare_channels_prefix_is_not_registered():
    """The literal guard itself: a bare "/channels/" (or "/api/channels/",
    etc.) entry must never appear in _PUBLIC_ENDPOINTS -- that would exempt
    every configuration route by startswith-prefix, not just ingress."""

    forbidden = (
        "/channels/",
        "/api/channels/",
        "/preview/channels/",
        "/api/preview/channels/",
    )

    for entry in _PUBLIC_ENDPOINTS:
        assert entry not in forbidden, f"{entry!r} would make all of /channels/ public"

    # Stronger form of the same guarantee: no *registered* public endpoint
    # is a strict prefix-only stub for the channels domain (every one of
    # them must extend past "/channels/" with a real ingress path segment).
    channel_entries = [e for e in _PUBLIC_ENDPOINTS if "channels/" in e]
    for entry in channel_entries:
        after = entry.split("channels/", 1)[1]
        assert after, f"{entry!r} has nothing after 'channels/' -- too broad"
