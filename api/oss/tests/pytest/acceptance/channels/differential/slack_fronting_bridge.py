"""A bridge whose own platform integration happens to be Slack: the ASGI app
that stands in for "the small bridge process" `BridgeAdapter` talks to over
the wire, wired to reach the exact same `FakeSlackWorkspace` instance the
in-process arm drives directly.

Delivery (core -> bridge -> Slack) reuses the real `SlackAdapter` for the
actual Slack call instead of reimplementing Block Kit rendering or button
degradation: a real bridge author targeting Slack would do the same, and
reusing it is what makes a divergence here the bridge's fault, never a
second, drifted copy of Slack's own rendering rules.
"""

import json
from typing import Any, Dict
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from oss.src.core.channels.adapters.bridge.signature import verify_bridge_signature
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.dtos import ChannelConnection
from oss.src.core.channels.types import ChannelSignatureInvalid

_EDIT_TYPE = "io.agenta.channel.message.edit.v1"


def build_slack_fronting_bridge_app(
    *,
    secret: str,
    slack_adapter: SlackAdapter,
    slack_connection: ChannelConnection,
) -> FastAPI:
    """One ASGI app playing the far side of the wire: verifies the signed
    delivery command core sends, replays it against Slack through the exact
    `SlackAdapter` instance the in-process arm also drives, and answers a
    `bridge.receipt` shaped from Slack's own response -- the same
    `{channel, ts}` shape the in-process arm's own receipt carries, so a
    test can compare the two directly."""

    app = FastAPI()

    @app.post("/deliver")
    async def deliver(request: Request) -> JSONResponse:
        body = await request.body()
        headers = {k.lower(): v for k, v in request.headers.items()}

        try:
            verify_bridge_signature(headers=headers, body=body, secret=secret)
        except ChannelSignatureInvalid:
            return JSONResponse({"error": "signature_invalid"}, status_code=401)

        command: Dict[str, Any] = json.loads(body) if body else {}
        data = command.get("data") or {}
        locator = data.get("locator") or {}
        content = data.get("content") or []
        idempotency_key = command.get("idempotency_key") or str(uuid4())

        try:
            if command.get("type") == _EDIT_TYPE:
                receipt = await slack_adapter.edit_message(
                    connection=slack_connection,
                    external_locator=locator,
                    content=content,
                    idempotency_key=uuid4(),
                )
            else:
                receipt = await slack_adapter.post_message(
                    connection=slack_connection,
                    locator=locator,
                    content=content,
                    idempotency_key=uuid4(),
                )
        except Exception as e:  # noqa: BLE001 - Slack's own failure, relayed as a bridge failure
            return JSONResponse(
                {
                    "type": "bridge.receipt",
                    "idempotency_key": idempotency_key,
                    "error": str(e),
                }
            )

        return JSONResponse(
            {
                "type": "bridge.receipt",
                "idempotency_key": idempotency_key,
                "external_locator": receipt,
            }
        )

    return app
