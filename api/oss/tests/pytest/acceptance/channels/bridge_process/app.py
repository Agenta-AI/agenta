"""The far side of the wire: an ASGI app playing a bridge.

Answers the registration handshake with a declaration the test supplies,
accepts signed delivery commands, records them, and answers a receipt.
Rejects a bad signature, a stale timestamp, an unknown event type and a
malformed envelope -- a bridge that accepts anything proves nothing.

Every value this app returns that a test can assert on -- receipt message
ids, dedup decisions -- comes from a seeded counter, never the wall clock or
randomness. Signature freshness is checked against the timestamp the caller
(core, or the harness standing in for a stale caller) put in the request
header, never `time.time()`, so a test can hand this app a deliberately
stale signature and get a deterministic rejection.
"""

import hashlib
import hmac
import json
import time
from itertools import count
from typing import Any, Dict, List

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

_VERSION = "v0"
SIGNATURE_HEADER = "x-agenta-bridge-signature"
TIMESTAMP_HEADER = "x-agenta-bridge-timestamp"
_REPLAY_WINDOW_SECONDS = 300
_KNOWN_DELIVERY_TYPES = {
    "io.agenta.channel.message.deliver.v1",
    "io.agenta.channel.message.edit.v1",
}


def _digest(*, secret: str, timestamp: str, body: bytes) -> str:
    signed_bytes = f"{_VERSION}:{timestamp}:".encode("utf-8") + body
    return (
        f"{_VERSION}="
        + hmac.new(secret.encode("utf-8"), signed_bytes, hashlib.sha256).hexdigest()
    )


class BridgeProcess:
    """State the ASGI app closes over. One instance == one bridge
    installation, with its own secret and declaration."""

    def __init__(self, *, name: str, secret: str, hello: Dict[str, Any]):
        self.name = name
        self.secret = secret
        self.hello = hello
        self._counter = count(1)
        self.received_deliveries: List[Dict[str, Any]] = []
        self.received_signatures: List[Dict[str, str]] = []
        self._seen_idempotency_keys: set = set()
        self._receipts_by_key: Dict[str, Dict[str, Any]] = {}

    def next_seq(self) -> int:
        return next(self._counter)

    def verify(self, *, headers: Dict[str, str], body: bytes) -> bool:
        # Freshness is inherently a real-clock property of replay protection;
        # only `ts`/receipt/idempotency VALUES asserted on are seeded.
        signature = headers.get(SIGNATURE_HEADER)
        timestamp = headers.get(TIMESTAMP_HEADER)
        if not signature or not timestamp:
            return False
        try:
            sent_at = int(timestamp)
        except ValueError:
            return False
        if abs(time.time() - sent_at) > _REPLAY_WINDOW_SECONDS:
            return False
        expected = _digest(secret=self.secret, timestamp=timestamp, body=body)
        return hmac.compare_digest(expected, signature)


def build_bridge_app(bridge: BridgeProcess) -> FastAPI:
    """One ASGI app per bridge instance -- the harness starts one process per
    bridge, so each has its own secret and declaration rather than branching
    on an installation id inside a shared app."""

    app = FastAPI()
    app.state.bridge = bridge

    @app.get("/_test/health")
    async def health() -> Dict[str, str]:
        return {"status": "ok"}

    @app.get("/_test/hello")
    async def hello() -> Dict[str, Any]:
        return bridge.hello

    @app.get("/_test/deliveries")
    async def deliveries() -> Dict[str, Any]:
        """Inspectable ordered list of every delivery command this bridge
        accepted, for the test to assert against directly."""
        return {"deliveries": bridge.received_deliveries}

    @app.post("/deliver")
    async def deliver(request: Request) -> JSONResponse:
        """Where core's outbound delivery lands."""

        body = await request.body()
        headers = {k.lower(): v for k, v in request.headers.items()}

        if not bridge.verify(headers=headers, body=body):
            return JSONResponse({"error": "signature_invalid"}, status_code=401)

        bridge.received_signatures.append(headers)

        try:
            command = json.loads(body) if body else None
        except ValueError:
            return JSONResponse({"error": "malformed_envelope"}, status_code=400)

        if not isinstance(command, dict) or "type" not in command:
            return JSONResponse({"error": "malformed_envelope"}, status_code=400)

        if command.get("type") not in _KNOWN_DELIVERY_TYPES:
            return JSONResponse({"error": "unknown_event_type"}, status_code=400)

        idempotency_key = command.get("idempotency_key")
        if not idempotency_key:
            return JSONResponse({"error": "malformed_envelope"}, status_code=400)

        locator = (command.get("data") or {}).get("locator") or {}

        if idempotency_key in bridge._seen_idempotency_keys:
            # Deduplicate on the token alone -- a retry of the same command
            # is answered with the receipt already minted, and not recorded
            # a second time in received_deliveries.
            return JSONResponse(bridge._receipts_by_key[idempotency_key])

        bridge._seen_idempotency_keys.add(idempotency_key)
        bridge.received_deliveries.append(command)

        seq = bridge.next_seq()
        receipt = {
            "type": "bridge.receipt",
            "idempotency_key": idempotency_key,
            "external_locator": {**locator, "message_id": f"{bridge.name}-msg-{seq}"},
        }
        bridge._receipts_by_key[idempotency_key] = receipt

        return JSONResponse(receipt)

    return app
