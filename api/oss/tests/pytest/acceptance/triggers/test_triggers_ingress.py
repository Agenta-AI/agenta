"""Acceptance tests for POST /triggers/composio/events (inbound ingress).

The ingress is the inbound dual of webhooks: a public (no Agenta auth) endpoint
that Composio POSTs provider events to. It ACKs fast (202) and enqueues dispatch
asynchronously; the actual workflow run + delivery write happen in a separate
worker, so the unconditional paths here are DB-free:

  - an event for an unknown trigger id is a clean 202 no-op (nothing to route);
  - an event with no routable metadata is a clean 202 no-op.

The signature-rejection path only bites when COMPOSIO_WEBHOOK_SECRET is set
(unset → 200/202 no-op, mirroring the Stripe receiver), so it is gated on that.
The full signed-event -> workflow-invoked -> single-delivery roundtrip needs the
live Composio adapter and a bound workflow, so it is gated on COMPOSIO_API_KEY.

Requires a running API.
"""

import os
from uuid import uuid4

import pytest


_COMPOSIO_ENABLED = bool(os.getenv("COMPOSIO_API_KEY"))
_WEBHOOK_SECRET = os.getenv("COMPOSIO_WEBHOOK_SECRET")

_requires_composio = pytest.mark.skipif(
    not _COMPOSIO_ENABLED,
    reason="needs live Composio credentials (COMPOSIO_API_KEY)",
)
_requires_webhook_secret = pytest.mark.skipif(
    not _WEBHOOK_SECRET,
    reason="needs COMPOSIO_WEBHOOK_SECRET set to verify signature rejection",
)


# ---------------------------------------------------------------------------
# DB-only: unknown trigger / no metadata are clean 202 no-ops
# ---------------------------------------------------------------------------


class TestTriggerIngressNoOps:
    def test_unknown_trigger_id_is_accepted_noop(self, unauthed_api):
        response = unauthed_api(
            "POST",
            "/triggers/composio/events",
            json={
                "type": "github_star_added_event",
                "metadata": {
                    "trigger_id": f"ti_{uuid4().hex}",
                    "id": uuid4().hex,
                },
                "data": {"repository": "acme/widgets"},
            },
        )
        assert response.status_code == 202, response.text
        assert response.json()["status"] == "accepted"

    def test_no_routable_metadata_is_accepted_noop(self, unauthed_api):
        response = unauthed_api(
            "POST",
            "/triggers/composio/events",
            json={"type": "some_event", "data": {}},
        )
        assert response.status_code == 202, response.text
        assert response.json()["status"] == "accepted"

    def test_empty_body_is_accepted_noop(self, unauthed_api):
        response = unauthed_api("POST", "/triggers/composio/events", data=b"")
        assert response.status_code == 202, response.text


@_requires_webhook_secret
class TestTriggerIngressSignature:
    def test_forged_signature_is_rejected(self, unauthed_api):
        response = unauthed_api(
            "POST",
            "/triggers/composio/events",
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


# ---------------------------------------------------------------------------
# Dedup (needs Composio) — a duplicate metadata.id does not double-write a
# delivery. Exercised end-to-end via a real subscription bound to a workflow.
# ---------------------------------------------------------------------------


@_requires_composio
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
                        "trigger_config": {},
                        "inputs_fields": {"repo": "$.event.data.repository"},
                        "references": {"workflow": {"slug": "triage"}},
                    },
                }
            },
        )
        assert create.status_code == 200, create.text
        sub = create.json()["subscription"]
        subscription_id = sub["id"]
        ti_id = sub["data"]["ti_id"]

        event_id = uuid4().hex
        envelope = {
            "type": "github_star_added_event",
            "metadata": {"trigger_id": ti_id, "id": event_id},
            "data": {"repository": "acme/widgets"},
        }

        # Post the same event twice (provider redelivery) — dedup must hold.
        for _ in range(2):
            ack = unauthed_api("POST", "/triggers/composio/events", json=envelope)
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
