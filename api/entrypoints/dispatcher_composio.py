#!/usr/bin/env python3
"""Dev-only Composio→Agenta event bridge (the `stripe listen` equivalent).

Composio has no CLI tunnel, so for local dev this subscribes to trigger events
over Composio's WebSocket (``composio.triggers.subscribe()``) and forwards each
one to the local ingress, signed with the same webhook secret the API verifies
against — so the real HMAC path is exercised, not bypassed.

Per-dev isolation needs nothing here: the API drops any event whose ``ti_*`` is
not in this environment's DB, so each dev only processes their own instances.

Usage (host):
    set -a; source hosting/docker-compose/ee/.env.ee.dev; set +a
    AGENTA_INGRESS_URL=http://localhost/api/triggers/composio/events/ \
        python api/entrypoints/dispatcher_composio.py

In docker-compose it runs as the `triggers-bridge` service (profile
`with-tunnel`, on by default; disable with `run.sh --no-tunnel`) and forwards to
http://api:8000/triggers/composio/events/.
"""

import hashlib
import hmac
import json
import os
import sys
import time
import uuid

import httpx
from composio import Composio

INGRESS_URL = os.getenv(
    "AGENTA_INGRESS_URL", "http://api:8000/triggers/composio/events/"
)
COMPOSIO_API_URL = os.getenv(
    "COMPOSIO_API_URL", "https://backend.composio.dev/api/v3"
).rstrip("/")


def _webhook_secret(api_key: str) -> str:
    """Wait for the API to register the webhook, then return its secret."""
    headers = {"x-api-key": api_key, "Content-Type": "application/json"}
    with httpx.Client(timeout=20, base_url=COMPOSIO_API_URL) as c:
        while True:
            try:
                r = c.get("/webhook_subscriptions", headers=headers)
                r.raise_for_status()
                items = r.json().get("items", [])
                if items:
                    return items[0]["secret"]
            except Exception as e:  # noqa: BLE001
                print(f"[bridge] waiting for webhook subscription: {e}")
            print("[bridge] no webhook subscription yet — waiting for the API…")
            time.sleep(5)


def _sign(secret: str, webhook_id: str, timestamp: str, body: bytes) -> str:
    signed = f"{webhook_id}.{timestamp}.{body.decode('utf-8', errors='replace')}"
    return hmac.new(secret.encode(), signed.encode(), hashlib.sha256).hexdigest()


def main() -> int:
    api_key = os.getenv("COMPOSIO_API_KEY")
    if not api_key:
        sys.exit("COMPOSIO_API_KEY not set.")

    secret = _webhook_secret(api_key)
    composio = Composio(api_key=api_key)
    forward = httpx.Client(timeout=20)

    print(f"[bridge] forwarding Composio events → {INGRESS_URL}")
    subscription = composio.triggers.subscribe()

    @subscription.handle()
    def _on_event(data) -> None:  # noqa: ANN001
        md = dict(data.get("metadata") or {})
        trigger_id = md.get("trigger_id") or md.get("id") or data.get("id")
        event_id = f"evt_{uuid.uuid4().hex}"
        md["trigger_id"] = trigger_id
        md["id"] = event_id
        envelope = {**data, "metadata": md}

        print(f"[bridge] event {trigger_id} {event_id}:")
        print(json.dumps(envelope, default=str, indent=2))

        body = json.dumps(envelope, default=str).encode()
        timestamp = str(int(time.time()))
        headers = {
            "Content-Type": "application/json",
            "webhook-id": event_id,
            "webhook-timestamp": timestamp,
            "webhook-signature": _sign(secret, event_id, timestamp, body),
        }
        try:
            resp = forward.post(INGRESS_URL, content=body, headers=headers)
            print(f"[bridge] {trigger_id} {event_id} → {resp.status_code}")
        except Exception as e:  # noqa: BLE001
            print(f"[bridge] forward failed: {e}")

    subscription.wait_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
