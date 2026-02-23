import json
from datetime import datetime, timezone
from uuid import UUID

import httpx
import hmac
import hashlib

from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.core.webhooks.circuit_breaker import circuit_breaker
from oss.src.core.webhooks.config import WEBHOOK_TIMEOUT
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _extract_signing_secret(secret_dto) -> str | None:
    """Extract webhook signing secret from SecretResponseDTO payload."""
    data = secret_dto.data if secret_dto else None

    provider = None
    if hasattr(data, "provider"):
        provider = data.provider
    elif isinstance(data, dict):
        provider = data.get("provider")

    if hasattr(provider, "key"):
        return provider.key
    if isinstance(provider, dict):
        return provider.get("key")

    return None


async def deliver_webhook(
    delivery_id: UUID,
    dao: WebhooksDAOInterface,
) -> None:
    """Deliver a webhook payload and update delivery status in-place."""
    delivery = await dao.get_delivery(delivery_id)
    if not delivery:
        log.error(f"Webhook delivery {delivery_id} not found")
        return

    subscription = await dao.fetch_subscription_by_id(delivery.subscription_id)
    if not subscription:
        await dao.update_delivery_status(
            delivery_id=delivery_id,
            status="failed",
            data={**(delivery.data or {}), "error": "Subscription not found"},
        )
        return

    if not subscription.is_active:
        await dao.update_delivery_status(
            delivery_id=delivery_id,
            status="failed",
            data={**(delivery.data or {}), "error": "Subscription inactive"},
        )
        return

    if await circuit_breaker.is_open(str(subscription.id)):
        await dao.update_delivery_status(
            delivery_id=delivery_id,
            status="retrying",
            data={
                **(delivery.data or {}),
                "error": "Circuit breaker open - endpoint failing repeatedly",
            },
        )
        return

    payload = (delivery.data or {}).get("payload") or {}
    event_type = (delivery.data or {}).get("event_type") or "unknown"
    payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))

    signing_secret = None
    if subscription.secret_id:
        vault_service = VaultService(SecretsDAO())
        secret_dto = await vault_service.get_secret(
            secret_id=subscription.secret_id,
            project_id=subscription.project_id,
        )
        signing_secret = _extract_signing_secret(secret_dto)

    if not signing_secret:
        await dao.update_delivery_status(
            delivery_id=delivery_id,
            status="failed",
            data={**(delivery.data or {}), "error": "Webhook signing secret not found"},
        )
        return

    to_sign = f"{timestamp}.{payload_json}"
    signature = hmac.new(
        key=signing_secret.encode("utf-8"),
        msg=to_sign.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Agenta-Webhook/1.0",
        "X-Agenta-Delivery-ID": str(delivery.id),
        "X-Agenta-Event-Type": event_type,
        "X-Agenta-Signature": f"t={timestamp},v1={signature}",
    }

    headers.update(subscription.headers or {})

    try:
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT) as client:
            start_time = datetime.now(timezone.utc)
            response = await client.post(
                subscription.url,
                content=payload_json,
                headers=headers,
            )
            duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            response.raise_for_status()

            await circuit_breaker.record_success(str(subscription.id))
            await dao.update_delivery_status(
                delivery_id=delivery_id,
                status="success",
                data={
                    **(delivery.data or {}),
                    "duration_ms": int(duration),
                    "response": {
                        "status_code": response.status_code,
                        "body": response.text[:2000],
                    },
                },
            )

    except Exception as e:
        log.warning(f"Error delivering webhook {delivery_id}: {e}")
        await circuit_breaker.record_failure(str(subscription.id))

        response_status_code = None
        response_body = str(e)
        if isinstance(e, httpx.HTTPStatusError):
            response_status_code = e.response.status_code
            response_body = e.response.text[:2000]

        await dao.update_delivery_status(
            delivery_id=delivery_id,
            status="retrying",
            data={
                **(delivery.data or {}),
                "error": str(e),
                "response": {
                    "status_code": response_status_code,
                    "body": response_body,
                },
            },
        )

        raise e
