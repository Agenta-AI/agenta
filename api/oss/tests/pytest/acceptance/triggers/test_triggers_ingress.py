"""Acceptance tests for POST /triggers/composio/events (inbound ingress).

The ingress is the inbound dual of webhooks: a public (no Agenta auth) endpoint
that Composio POSTs provider events to. It verifies the Composio HMAC signature
(secret resolved from Composio, cached encrypted in Redis), ACKs fast (202), and
enqueues dispatch asynchronously; the workflow run + delivery write happen in a
separate worker. Unlike the Stripe receiver, an unsigned/forged event is NOT a
no-op — verification is unconditional, so such requests are rejected with 401.

Verification also rejects a stale `webhook-timestamp` and a replayed
`webhook-id`: a captured/redelivered request outside the freshness
window, or a repeat of a `webhook-id` already seen within it, gets 401 at the
signature layer rather than reaching dispatch.

The signature-rejection path only fires when a webhook secret can be resolved,
which needs Composio enabled (COMPOSIO_API_KEY). The full signed-event ->
workflow-invoked -> single-delivery roundtrip also needs a bound workflow, so it
too is gated on COMPOSIO_API_KEY.

Requires a running API.
"""

import hashlib
import hmac
import json
import os
import time
from uuid import uuid4

import httpx
import pytest


_COMPOSIO_ENABLED = bool(os.getenv("COMPOSIO_API_KEY"))
_COMPOSIO_API_URL = os.getenv(
    "COMPOSIO_API_URL", "https://backend.composio.dev/api/v3"
).rstrip("/")


def _resolve_webhook_secret() -> str:
    """Read the project's Composio webhook secret (same path the API uses)."""
    api_key = os.getenv("COMPOSIO_API_KEY")
    with httpx.Client(timeout=20, base_url=_COMPOSIO_API_URL) as client:
        resp = client.get(
            "/webhook_subscriptions",
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
    return items[0]["secret"] if items else ""


def _sign(secret: str, webhook_id: str, timestamp: str, body: bytes) -> str:
    signed = f"{webhook_id}.{timestamp}.{body.decode('utf-8')}"
    return hmac.new(secret.encode(), signed.encode(), hashlib.sha256).hexdigest()


_requires_composio = pytest.mark.skipif(
    not _COMPOSIO_ENABLED,
    reason="needs live Composio credentials (COMPOSIO_API_KEY)",
)

# Minting a trigger instance needs an ACTIVE connected account, which a stub
# OAuth connection never reaches in CI (no interactive auth).
_requires_connected_account = pytest.mark.skipif(
    not os.getenv("COMPOSIO_TEST_CONNECTED_ACCOUNT"),
    reason="needs COMPOSIO_TEST_CONNECTED_ACCOUNT (an ACTIVE connected account)",
)


# ---------------------------------------------------------------------------
# Signature verification is unconditional — unsigned/forged events are rejected.
# Needs a resolvable webhook secret, which requires Composio enabled.
# ---------------------------------------------------------------------------


@_requires_composio
class TestTriggerIngressSignature:
    def test_unsigned_event_is_rejected(self, unauthed_api):
        response = unauthed_api(
            "POST",
            "/triggers/composio/events/",
            json={
                "type": "github_star_added_event",
                "metadata": {"trigger_id": f"ti_{uuid4().hex}", "id": uuid4().hex},
                "payload": {"repository": "acme/widgets"},
            },
        )
        assert response.status_code == 401, response.text

    def test_forged_signature_is_rejected(self, unauthed_api):
        response = unauthed_api(
            "POST",
            "/triggers/composio/events/",
            headers={
                "webhook-id": "msg_1",
                "webhook-timestamp": "1700000000",
                "webhook-signature": "v1,deadbeef",
            },
            json={
                "metadata": {"trigger_id": f"ti_{uuid4().hex}", "id": uuid4().hex},
            },
        )
        assert response.status_code == 401, response.text

    def test_empty_unsigned_body_is_rejected(self, unauthed_api):
        response = unauthed_api("POST", "/triggers/composio/events/", data=b"")
        assert response.status_code == 401, response.text


# ---------------------------------------------------------------------------
# Replay/freshness — a stale timestamp or a repeated webhook-id is
# rejected at the signature layer; a fresh, first-seen request is accepted.
# ---------------------------------------------------------------------------


@_requires_composio
class TestTriggerIngressReplayAndFreshness:
    def test_stale_timestamp_is_rejected(self, unauthed_api):
        secret = _resolve_webhook_secret()
        if not secret:
            pytest.skip("no Composio webhook secret resolvable; signing would 401")

        webhook_id = f"msg_{uuid4().hex}"
        stale_timestamp = str(int(time.time()) - 3600)
        envelope = {
            "type": "github_star_added_event",
            "metadata": {"trigger_id": f"ti_{uuid4().hex}", "id": uuid4().hex},
            "payload": {"repository": "acme/widgets"},
        }
        body = json.dumps(envelope).encode()
        headers = {
            "Content-Type": "application/json",
            "webhook-id": webhook_id,
            "webhook-timestamp": stale_timestamp,
            "webhook-signature": _sign(secret, webhook_id, stale_timestamp, body),
        }

        response = unauthed_api(
            "POST", "/triggers/composio/events/", data=body, headers=headers
        )
        assert response.status_code == 401, response.text

    def test_replayed_webhook_id_is_rejected_within_the_window(self, unauthed_api):
        secret = _resolve_webhook_secret()
        if not secret:
            pytest.skip("no Composio webhook secret resolvable; signing would 401")

        webhook_id = f"msg_{uuid4().hex}"
        timestamp = str(int(time.time()))
        envelope = {
            "type": "github_star_added_event",
            "metadata": {"trigger_id": f"ti_{uuid4().hex}", "id": uuid4().hex},
            "payload": {"repository": "acme/widgets"},
        }
        body = json.dumps(envelope).encode()
        headers = {
            "Content-Type": "application/json",
            "webhook-id": webhook_id,
            "webhook-timestamp": timestamp,
            "webhook-signature": _sign(secret, webhook_id, timestamp, body),
        }

        first = unauthed_api(
            "POST", "/triggers/composio/events/", data=body, headers=headers
        )
        assert first.status_code == 202, first.text

        replay = unauthed_api(
            "POST", "/triggers/composio/events/", data=body, headers=headers
        )
        assert replay.status_code == 401, replay.text


# ---------------------------------------------------------------------------
# Dedup (needs Composio) — a duplicate metadata.id does not double-write a
# delivery. Exercised end-to-end via a real subscription bound to a workflow.
# Each delivery attempt uses its own webhook-id/timestamp (a distinct
# provider-level delivery), since a repeated webhook-id is now rejected
# upstream by the replay guard — this dedup is the metadata.id ->
# delivery-row layer beneath it.
# ---------------------------------------------------------------------------


@_requires_composio
@_requires_connected_account
class TestTriggerIngressDedup:
    def test_duplicate_event_id_writes_single_delivery(self, authed_api, unauthed_api):
        # Create a connection + subscription so an inbound ti_* resolves locally.
        slug = f"acc-{uuid4().hex[:8]}"
        conn = authed_api(
            "POST",
            "/tools/connections/",
            json={
                "connection": {
                    "slug": slug,
                    "provider_key": "composio",
                    "integration_key": "github",
                    "data": {"auth_scheme": "oauth"},
                }
            },
        )
        assert conn.status_code == 200, conn.text
        connection_id = conn.json()["connection"]["id"]

        create = authed_api(
            "POST",
            "/triggers/subscriptions/",
            json={
                "subscription": {
                    "name": f"sub-{uuid4().hex[:8]}",
                    "connection_id": connection_id,
                    "data": {
                        "event_key": "GITHUB_STAR_ADDED_EVENT",
                        "trigger_config": {"owner": "acme", "repo": "widgets"},
                        "inputs_fields": {"repo": "$.event.attributes.repository"},
                        "references": {"workflow": {"slug": "triage"}},
                    },
                }
            },
        )
        assert create.status_code == 200, create.text
        sub = create.json()["subscription"]
        subscription_id = sub["id"]
        trigger_id = sub["trigger_id"]

        event_id = uuid4().hex
        envelope = {
            "type": "github_star_added_event",
            "metadata": {"trigger_id": trigger_id, "id": event_id},
            "payload": {"repository": "acme/widgets"},
        }
        body = json.dumps(envelope).encode()
        secret = _resolve_webhook_secret()
        if not secret:
            pytest.skip("no Composio webhook secret resolvable; signing would 401")

        # Post the same logical event twice (provider redelivery) as two DISTINCT
        # provider-level deliveries (own webhook-id/timestamp each) — the
        # replay guard dedups webhook-id, not metadata.id, so this exercises the
        # delivery-row dedup layer beneath it.
        for _ in range(2):
            webhook_id = f"msg_{uuid4().hex}"
            timestamp = str(int(time.time()))
            headers = {
                "Content-Type": "application/json",
                "webhook-id": webhook_id,
                "webhook-timestamp": timestamp,
                "webhook-signature": _sign(secret, webhook_id, timestamp, body),
            }
            ack = unauthed_api(
                "POST", "/triggers/composio/events/", data=body, headers=headers
            )
            assert ack.status_code == 202, ack.text

        # The dispatch is async; the dedup guard means at most one delivery row
        # exists for this (subscription, event_id).
        deliveries = authed_api(
            "POST",
            "/triggers/deliveries/query",
            json={
                "delivery": {"subscription_id": subscription_id, "event_id": event_id}
            },
        ).json()["deliveries"]
        assert len(deliveries) <= 1

        authed_api("DELETE", f"/triggers/subscriptions/{subscription_id}")
        authed_api("DELETE", f"/tools/connections/{connection_id}")
