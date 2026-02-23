"""Webhooks service layer."""

import secrets
import string
from typing import List, Optional, TYPE_CHECKING
from uuid import UUID
import uuid_utils.compat as uuid

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import SecretKind, StandardProviderKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.webhooks.dtos import (
    CreateWebhookSubscriptionDTO,
    UpdateWebhookSubscriptionDTO,
    WebhookSubscriptionQueryDTO,
    WebhookSubscriptionResponseDTO,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:
    from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker

log = get_module_logger(__name__)


class WebhooksService:
    def __init__(
        self,
        dao: WebhooksDAOInterface,
        webhooks_worker: Optional["WebhooksWorker"] = None,
    ):
        self.dao = dao
        self.webhooks_worker = webhooks_worker

    def _generate_secret(self) -> str:
        """Generate a secure random secret for webhooks."""
        alphabet = string.ascii_letters + string.digits
        return "".join(secrets.choice(alphabet) for _ in range(32))

    async def create_subscription(
        self,
        project_id: UUID,
        payload: CreateWebhookSubscriptionDTO,
        user_id: UUID,
    ) -> WebhookSubscriptionResponseDTO:
        secret = self._generate_secret()
        vault_service = VaultService(SecretsDAO())
        secret_dto = await vault_service.create_secret(
            project_id=project_id,
            create_secret_dto=CreateSecretDTO(
                header={
                    "name": f"webhook-{payload.name}",
                    "description": "Webhook signing secret",
                },
                secret=SecretDTO(
                    kind=SecretKind.PROVIDER_KEY,
                    data=StandardProviderDTO(
                        kind=StandardProviderKind.OPENAI,
                        provider=StandardProviderSettingsDTO(key=secret),
                    ),
                ),
            ),
        )

        return await self.dao.create_subscription(
            project_id=project_id,
            payload=payload,
            user_id=user_id,
            secret_id=secret_dto.id,
        )

    async def query_subscriptions(
        self,
        project_id: UUID,
        filters: Optional[WebhookSubscriptionQueryDTO] = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[List[WebhookSubscriptionResponseDTO], int]:
        return await self.dao.query_subscriptions(
            project_id=project_id,
            filters=filters,
            offset=offset,
            limit=limit,
        )

    async def get_subscription(
        self, project_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        return await self.dao.get_subscription(
            project_id=project_id, subscription_id=subscription_id
        )

    async def update_subscription(
        self,
        project_id: UUID,
        subscription_id: UUID,
        payload: UpdateWebhookSubscriptionDTO,
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        return await self.dao.update_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
            payload=payload,
        )

    async def archive_subscription(
        self, project_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        return await self.dao.archive_subscription(
            project_id=project_id, subscription_id=subscription_id
        )

    async def trigger_event(
        self, project_id: UUID, event_type: str, payload: dict
    ) -> None:
        """
        Triggers a webhook event: finds subscribers and enqueues delivery tasks.
        """
        # 1. Get subscribers
        subscriptions = await self.dao.get_active_subscriptions_for_event(
            project_id, event_type
        )

        if not subscriptions:
            # No active subscriptions for this event
            return

        if not self.webhooks_worker:
            log.warning(
                f"WebhooksWorker is not configured. Skipping delivery for event type {event_type}"
            )
            return

        # 2. Create deliveries and queue tasks
        for sub in subscriptions:
            try:
                delivery = await self.dao.create_delivery(
                    subscription_id=sub.id,
                    event_id=uuid.uuid7(),
                    status="pending",
                    created_by_id=sub.created_by_id,
                    data={
                        "event_type": event_type,
                        "payload": payload,
                        "url": sub.url,
                    },
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
        self,
        url: str,
        event_type: str,
        project_id: UUID,
        user_id: UUID,
        subscription_id: Optional[UUID] = None,
    ) -> dict:
        """
        Tests a webhook endpoint with valid signature.

        Sends a test payload with:
        - Real project_id (not dummy)
        - Valid HMAC signature using temporary test secret
        - Clear indication this is a test ("test": true)
        - Returns test secret for signature verification

        Args:
            url: Webhook endpoint URL to test
            event_type: Event type to test (e.g., "config.deployed")
            project_id: Actual project ID
            user_id: User triggering the test
            subscription_id: Optional subscription ID to record delivery against

        Returns:
            Dict with success status, response details, and test secret for verification
        """
        import httpx
        import hmac
        import hashlib
        import json
        from datetime import datetime, timezone
        import uuid_utils.compat as uuid

        # This is returned to caller for local signature verification.
        test_secret = self._generate_secret()

        # Construct test payload with real project_id
        payload = {
            "id": f"evt_test_{str(uuid.uuid4())[:8]}",
            "event_type": event_type,
            "project_id": str(project_id),  # Real project_id
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

        response_data = {
            "success": False,
            "status_code": None,
            "response_body": None,
            "duration_ms": 0,
            "test_secret": test_secret,
            "signature_format": "t=<timestamp>,v1=<hmac_sha256_hex>",
            "signing_payload": f"{timestamp}.{payload_json[:100]}...",
        }

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                start_time = datetime.now(timezone.utc)
                response = await client.post(url, content=payload_json, headers=headers)
                duration = (
                    datetime.now(timezone.utc) - start_time
                ).total_seconds() * 1000

                response_data.update(
                    {
                        "success": response.is_success,
                        "status_code": response.status_code,
                        "response_body": response.text[:1000],
                        "duration_ms": int(duration),
                    }
                )

        except Exception as e:
            response_data.update(
                {
                    "success": False,
                    "response_body": str(e),
                }
            )

        # Record delivery if subscription_id is provided
        if subscription_id:
            try:
                await self.dao.record_test_delivery(
                    subscription_id=subscription_id,
                    event_id=uuid.uuid7(),
                    status="success" if response_data["success"] else "failed",
                    created_by_id=user_id,
                    data={
                        "event_type": event_type,
                        "payload": payload,
                        "url": url,
                        "status_code": response_data["status_code"],
                        "response_body": response_data["response_body"],
                        "duration_ms": response_data["duration_ms"],
                    },
                )
            except Exception as e:
                log.error(f"Failed to record test delivery: {e}")

        return response_data
