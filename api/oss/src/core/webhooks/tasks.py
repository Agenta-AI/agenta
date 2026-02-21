import hmac
import hashlib
import json
import httpx
from datetime import datetime, timezone
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.core.webhooks.config import WEBHOOK_MAX_RETRIES, WEBHOOK_TIMEOUT

from oss.src.core.webhooks.circuit_breaker import circuit_breaker

log = get_module_logger(__name__)


async def deliver_webhook(
    delivery_id: UUID,
    dao: WebhooksDAOInterface,
) -> None:
    """
    Delivers a webhook payload to the subscribed URL (Append-Only Pattern).

    Flow:
    1. Fetch LATEST delivery attempt to get current state
    2. Make HTTP request
    3. INSERT new delivery attempt record with result
    4. Never update existing records
    """
    # 1. Fetch latest delivery attempt
    latest_delivery = await dao.get_latest_delivery(delivery_id)
    if not latest_delivery:
        log.error(f"Webhook delivery {delivery_id} not found")
        return

    # Check if already successful or max attempts reached (idempotency)
    if latest_delivery.status == "success":
        return
    if (
        latest_delivery.attempt_number >= latest_delivery.max_attempts
        and latest_delivery.status == "failed"
    ):
        return

    # 2. Fetch subscription
    subscription = await dao.fetch_subscription_by_id(latest_delivery.subscription_id)
    if not subscription:
        # Log failure attempt
        await dao.create_retry(
            delivery_id=delivery_id,
            subscription_id=latest_delivery.subscription_id,
            event_type=latest_delivery.event_type,
            payload=latest_delivery.payload,
            url=latest_delivery.url,
            attempt_number=latest_delivery.attempt_number + 1,
            status="failed",
            error_message="Subscription not found",
        )
        return

    if not subscription.is_active:
        await dao.create_retry(
            delivery_id=delivery_id,
            subscription_id=latest_delivery.subscription_id,
            event_type=latest_delivery.event_type,
            payload=latest_delivery.payload,
            url=latest_delivery.url,
            attempt_number=latest_delivery.attempt_number + 1,
            status="failed",
            error_message="Subscription inactive",
        )
        return

    # 3. Check circuit breaker
    if await circuit_breaker.is_open(str(subscription.id)):
        # Record skipped attempt
        await dao.create_retry(
            delivery_id=delivery_id,
            subscription_id=latest_delivery.subscription_id,
            event_type=latest_delivery.event_type,
            payload=latest_delivery.payload,
            url=subscription.url,  # Use current subscription URL
            attempt_number=latest_delivery.attempt_number + 1,
            status="retrying",
            error_message="Circuit breaker open - endpoint failing repeatedly",
        )
        # Don't raise exception - prevents Taskiq immediate retry
        # Will retry later when circuit is closed
        return

    payload = latest_delivery.payload
    current_attempt = latest_delivery.attempt_number + 1

    # 4. Create signature
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
        "X-Agenta-Delivery-ID": str(latest_delivery.id),
        "User-Agent": "Agenta-Webhook/1.0",
        "X-Agenta-Event-Type": latest_delivery.event_type,
    }

    try:
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT) as client:
            start_time = datetime.now(timezone.utc)
            response = await client.post(
                subscription.url, content=payload_json, headers=headers
            )
            duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            response.raise_for_status()

            # Success - INSERT new success record
            await circuit_breaker.record_success(str(subscription.id))
            await dao.create_retry(
                delivery_id=delivery_id,
                subscription_id=latest_delivery.subscription_id,
                event_type=latest_delivery.event_type,
                payload=latest_delivery.payload,
                url=subscription.url,
                attempt_number=current_attempt,
                status="success",
                status_code=response.status_code,
                response_body=response.text[:2000],
                duration_ms=int(duration),
            )

    except Exception as e:
        log.warning(f"Error delivering webhook {delivery_id}: {e}")

        await circuit_breaker.record_failure(str(subscription.id))

        duration = 0
        response_status_code = None
        response_body = str(e)

        if isinstance(e, httpx.HTTPStatusError):
            response_status_code = e.response.status_code
            response_body = e.response.text[:2000]

        # Determine status
        status = "retrying" if current_attempt < WEBHOOK_MAX_RETRIES else "failed"

        # INSERT new failure/retry record
        await dao.create_retry(
            delivery_id=delivery_id,
            subscription_id=latest_delivery.subscription_id,
            event_type=latest_delivery.event_type,
            payload=latest_delivery.payload,
            url=subscription.url,
            attempt_number=current_attempt,
            status=status,
            status_code=response_status_code,
            response_body=response_body,
            error_message=str(e),
            duration_ms=int(duration),
        )

        if status == "retrying":
            # Raise to trigger Taskiq retry
            raise e
