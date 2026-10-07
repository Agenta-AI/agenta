"""The Agenta-owned Slack app: mint the authorize URL, exchange the code.

The first authorization-code exchange in this repo. The gateway's OAuth
flow (`core/gateway/connections`) delegates the handshake to a managed
provider and its callback only decodes state -- nothing there exchanges a
code for a token, so this module borrows nothing from that shape beyond the
state signer.

Identity composition is deliberately NOT done here: the caller hands the
exchanged bot token to `SlackAdapter.verify_connection` (the same function
the customer-owned paste form uses), and that one function stays the only
place a Slack identity gets composed. This module only knows how to talk to
Slack's OAuth endpoints.
"""

from typing import Any, Dict, Optional
from urllib.parse import urlencode

import httpx
from pydantic import BaseModel

from oss.src.core.channels.adapters.slack.manifest import SLACK_BOT_SCOPES
from oss.src.utils.env import env

_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"
_TOKEN_URL = "https://slack.com/api/oauth.v2.access"

# An hour (the state signer's own default) is generous for a redirect that
# takes seconds; the install flow uses a shorter window.
INSTALL_STATE_MAX_AGE_SECONDS = 10 * 60


def hosted_app_configured() -> bool:
    """False for the common case: a deployment that never set the three
    hosted-app settings does not offer this flow at all."""

    return env.channels.slack.enabled


def build_authorize_url(*, state: str, redirect_uri: str) -> str:
    params = {
        "client_id": env.channels.slack.client_id or "",
        "scope": ",".join(SLACK_BOT_SCOPES),
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{_AUTHORIZE_URL}?{urlencode(params)}"


class SlackOAuthExchangeResult(BaseModel):
    """What `oauth.v2.access` returned. Never logged or repr'd with the
    token in a message -- callers read `access_token` directly."""

    ok: bool
    error: Optional[str] = None
    #
    app_id: Optional[str] = None
    access_token: Optional[str] = None
    bot_user_id: Optional[str] = None
    scope: Optional[str] = None


async def exchange_code(
    *,
    code: str,
    redirect_uri: str,
    http_client: Optional[httpx.AsyncClient] = None,
) -> SlackOAuthExchangeResult:
    """`oauth.v2.access` -- a code for a bot token. Never raises on a
    platform-level rejection (`ok: false`); that comes back in the result
    for the caller to show as Slack's own error, same discipline as
    `verify_connection`."""

    client = http_client or httpx.AsyncClient()
    try:
        response = await client.post(
            _TOKEN_URL,
            data={
                "client_id": env.channels.slack.client_id or "",
                "client_secret": env.channels.slack.client_secret or "",
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
    finally:
        if http_client is None:
            await client.aclose()

    body: Dict[str, Any] = response.json()

    return SlackOAuthExchangeResult(
        ok=bool(body.get("ok")),
        error=body.get("error"),
        app_id=body.get("app_id"),
        access_token=body.get("access_token"),
        bot_user_id=body.get("bot_user_id"),
        scope=body.get("scope"),
    )
