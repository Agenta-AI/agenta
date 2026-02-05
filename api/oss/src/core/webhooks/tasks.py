import hmac
import hashlib
import json
import httpx
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO
from oss.src.core.webhooks.config import WEBHOOK_MAX_RETRIES, WEBHOOK_TIMEOUT
from oss.src.core.webhooks.utils import calculate_next_retry_at
from oss.src.core.webhooks.circuit_breaker import circuit_breaker

log = get_module_logger(__name__)


async def deliver_webhook(
    delivery_id: UUID,
    dao: WebhooksDAO,
) -> None:
    """
    Delivers a webhook payload to the subscribed URL.
    Handles HMAC signing, HTTP request, and updating delivery status in DB.
    Raises exception on failure to trigger Taskiq retry if max retries not reached.
    """
    # 1. Fetch delivery
    delivery = await dao.get_delivery(delivery_id)
    if not delivery:
        log.error(f"Webhook delivery {delivery_id} not found")
        return

    # 2. Fetch subscription
    subscription = await dao.fetch_subscription_by_id(delivery.subscription_id)
    if not subscription:
        log.error(
            f"Webhook subscription {delivery.subscription_id} not found for delivery {delivery_id}"
        )
        await dao.update_delivery_status(
            delivery_id, "failed", error_message="Subscription not found"
        )
        return

    if not subscription.is_active:
        await dao.update_delivery_status(
            delivery_id, "failed", error_message="Subscription inactive"
        )
        return

    # 3. Check circuit breaker
    if await circuit_breaker.is_open(str(subscription.id)):
        log.warning(
            f"Circuit breaker OPEN for subscription {subscription.id}, "
            f"skipping delivery {delivery_id}"
        )
        # Don't retry immediately - mark as retrying with delayed next_retry_at
        await dao.update_delivery_status(
            delivery_id,
            "retrying",
            error_message="Circuit breaker open - endpoint failing repeatedly",
            next_retry_at=calculate_next_retry_at(delivery.attempts),
        )
        # Don't raise exception - prevents Taskiq immediate retry
        # Will retry later when circuit is closed
        return

    payload = delivery.payload

    # 4. Create signature
    # Use standard json separators to ensure consistent signing (no spaces)
    payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))

    to_sign = f"{timestamp}.{payload_json}"
    signature = hmac.new(
        key=subscription.secret.encode("utf-8"),
        msg=to_sign.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "X-Agenta-Signature": f"t={timestamp},v1={signature}",
        "X-Agenta-Event-ID": str(delivery.event_id)
        if delivery.event_id
        else str(delivery.id),
        "User-Agent": "Agenta-Webhook/1.0",
    }

    try:
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT) as client:
            start_time = datetime.now(timezone.utc)
            response = await client.post(
                subscription.url, content=payload_json, headers=headers
            )
            duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            response.raise_for_status()

            # success - record with circuit breaker
            await circuit_breaker.record_success(str(subscription.id))
            await dao.update_delivery_status(
                delivery_id,
                "success",
                response_status_code=response.status_code,
                response_body=response.text[:2000],  # Trucate body
                duration_ms=int(duration),
            )

    except Exception as e:
        log.warning(f"Error delivering webhook {delivery_id}: {e}")

        # Record failure with circuit breaker
        await circuit_breaker.record_failure(str(subscription.id))

        duration = 0  # Default if failed before request
        response_status_code = None
        response_body = str(e)

        if isinstance(e, httpx.HTTPStatusError):
            response_status_code = e.response.status_code
            response_body = e.response.text[:2000]

        # Determine status based on retries
        # Update DB first
        status = "retrying" if delivery.attempts < WEBHOOK_MAX_RETRIES else "failed"

        # Calculate next retry time with exponential backoff
        next_retry_at = None
        if status == "retrying":
            next_retry_at = calculate_next_retry_at(delivery.attempts)

        await dao.update_delivery_status(
            delivery_id,
            status,
            response_status_code=response_status_code,
            response_body=response_body,
            duration_ms=int(duration),
            error_message=str(e),
            next_retry_at=next_retry_at,
        )

        if status == "retrying":
            # Raise to trigger Taskiq retry
            raise e
