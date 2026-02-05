import secrets
import string
from typing import List, Optional, TYPE_CHECKING
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO
from oss.src.models.db_models import WebhookSubscriptionDB
from oss.src.apis.fastapi.webhooks.schemas import (
    CreateWebhookSubscription,
    UpdateWebhookSubscription,
)

if TYPE_CHECKING:
    from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker

log = get_module_logger(__name__)


class WebhooksService:
    def __init__(
        self, dao: WebhooksDAO, webhooks_worker: Optional["WebhooksWorker"] = None
    ):
        self.dao = dao
        self.webhooks_worker = webhooks_worker

    def _generate_secret(self) -> str:
        """Generate a secure random secret for webhooks."""
        alphabet = string.ascii_letters + string.digits
        return "".join(secrets.choice(alphabet) for _ in range(32))

    async def create_subscription(
        self,
        workspace_id: UUID,
        payload: CreateWebhookSubscription,
        user_id: Optional[UUID] = None,
    ) -> WebhookSubscriptionDB:
        secret = self._generate_secret()
        return await self.dao.create_subscription(
            workspace_id=workspace_id, payload=payload, user_id=user_id, secret=secret
        )

    async def list_subscriptions(
        self, workspace_id: UUID
    ) -> List[WebhookSubscriptionDB]:
        return await self.dao.list_subscriptions(workspace_id=workspace_id)

    async def get_subscription(
        self, workspace_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionDB]:
        return await self.dao.get_subscription(
            workspace_id=workspace_id, subscription_id=subscription_id
        )

    async def update_subscription(
        self,
        workspace_id: UUID,
        subscription_id: UUID,
        payload: UpdateWebhookSubscription,
    ) -> Optional[WebhookSubscriptionDB]:
        return await self.dao.update_subscription(
            workspace_id=workspace_id,
            subscription_id=subscription_id,
            payload=payload,
        )

    async def delete_subscription(
        self, workspace_id: UUID, subscription_id: UUID
    ) -> bool:
        return await self.dao.delete_subscription(
            workspace_id=workspace_id, subscription_id=subscription_id
        )

    async def trigger_event(
        self, workspace_id: UUID, event_type: str, payload: dict
    ) -> None:
        """
        Triggers a webhook event: records it, finds subscribers, and enqueues delivery tasks.
        """
        # 1. Archive event
        event = await self.dao.create_event(workspace_id, event_type, payload)

        # 2. Get subscribers
        subscriptions = await self.dao.get_active_subscriptions_for_event(
            workspace_id, event_type
        )

        if not subscriptions:
            # No active subscriptions for this event
            return

        if not self.webhooks_worker:
            log.warning(
                f"WebhooksWorker is not configured. Skipping delivery for event {event.id}"
            )
            return

        # 3. Create deliveries and queue tasks
        for sub in subscriptions:
            try:
                delivery = await self.dao.create_delivery(
                    subscription_id=sub.id,
                    event_type=event_type,
                    payload=payload,
                    event_id=event.id,
                )

                await self.webhooks_worker.deliver_webhook.kiq(delivery_id=delivery.id)
                log.info(
                    f"Enqueued webhook delivery {delivery.id} for subscription {sub.id}"
                )
            except Exception as e:
                log.error(
                    f"Failed to enqueue webhook delivery for subscription {sub.id}: {e}"
                )

    async def test_webhook(
        self, url: str, event_type: str, workspace_id: UUID, user_id: UUID
    ) -> dict:
        """
        Tests a webhook endpoint with valid signature.

        Sends a test payload with:
        - Real workspace_id (not dummy)
        - Valid HMAC signature using temporary test secret
        - Clear indication this is a test ("test": true)
        - Returns test secret for signature verification

        Args:
            url: Webhook endpoint URL to test
            event_type: Event type to test (e.g., "config.deployed")
            workspace_id: Actual workspace ID
            user_id: User triggering the test

        Returns:
            Dict with success status, response details, and test secret for verification
        """
        import httpx
        import hmac
        import hashlib
        import json
        from datetime import datetime, timezone
        import uuid_utils.compat as uuid

        # Generate temporary test secret (same length as real subscriptions)
        test_secret = self._generate_secret()

        # Construct test payload with real workspace_id
        payload = {
            "id": f"evt_test_{str(uuid.uuid4())[:8]}",
            "event_type": event_type,
            "workspace_id": str(workspace_id),  # Real workspace_id
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "test": True,  # Clear indicator this is a test
            "data": {
                "message": "This is a test webhook from Agenta. You can use the test_secret in the response to verify the signature.",
                "triggered_by": str(user_id),
            },
        }

        # Create HMAC signature (same as real deliveries)
        payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        timestamp = str(int(datetime.now(timezone.utc).timestamp()))
        to_sign = f"{timestamp}.{payload_json}"
        signature = hmac.new(
            key=test_secret.encode("utf-8"),
            msg=to_sign.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).hexdigest()

        headers = {
            "Content-Type": "application/json",
            "X-Agenta-Signature": f"t={timestamp},v1={signature}",
            "X-Agenta-Event": event_type,
            "X-Agenta-Delivery": f"del_test_{str(uuid.uuid4())[:8]}",
            "User-Agent": "Agenta-Webhook-Test/1.0",
        }

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                start_time = datetime.now(timezone.utc)
                response = await client.post(url, content=payload_json, headers=headers)
                duration = (
                    datetime.now(timezone.utc) - start_time
                ).total_seconds() * 1000

                return {
                    "success": response.is_success,
                    "status_code": response.status_code,
                    "response_body": response.text[:1000],
                    "duration_ms": int(duration),
                    # Return test secret for signature verification
                    "test_secret": test_secret,
                    "signature_format": "t=<timestamp>,v1=<hmac_sha256_hex>",
                    "signing_payload": f"{timestamp}.{payload_json[:100]}...",
                }
        except Exception as e:
            return {
                "success": False,
                "status_code": None,
                "response_body": str(e),
                "duration_ms": 0,
                "test_secret": test_secret,
                "signature_format": "t=<timestamp>,v1=<hmac_sha256_hex>",
            }
