"""Core webhook delivery logic invoked by the TaskIQ worker.

All data needed for delivery (URL, headers, encrypted secret, payload)
is passed inline in the task parameters — no DB reads during execution.
Only one write happens: a delivery record created on the final outcome.

Retry policy (enforced by TaskIQ):
  - 2xx                   → success delivery record, task completes normally
  - 1xx / 3xx / 4xx       → failure delivery record, task completes normally
                            (receiver understood; no retry makes sense)
  - 5xx / timeout / error → raise exception so TaskIQ retries
  - retries exhausted     → failure delivery record, re-raise
"""

import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import httpx

from oss.src.core.shared.dtos import Status
from oss.src.core.webhooks.types import (
    WEBHOOK_MAX_RETRIES,
    WEBHOOK_TIMEOUT,
    WebhookDeliveryCreate,
    WebhookDeliveryData,
    WebhookDeliveryResponseInfo,
    WebhookEventType,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.core.webhooks.utils import validate_webhook_url
from oss.src.utils.crypting import decrypt
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

NON_OVERRIDABLE_HEADERS = {
    "content-type",
    "content-length",
    "host",
    "user-agent",
    "x-agenta-event-type",
    "x-agenta-delivery-id",
    "x-agenta-signature",
}


def _is_retryable(status_code: int) -> bool:
    return status_code >= 500


def _merge_headers(
    *,
    user_headers: Optional[dict],
    system_headers: dict[str, str],
) -> dict[str, str]:
    merged: dict[str, str] = {}
    dropped: list[str] = []

    for key, value in (user_headers or {}).items():
        key_str = str(key)
        if key_str.lower() in NON_OVERRIDABLE_HEADERS:
            dropped.append(key_str)
            continue
        merged[key_str] = str(value)

    if dropped:
        log.warning(
            "[WEBHOOKS TASK] Dropped non-overwritable user headers: %s",
            ", ".join(sorted(set(dropped))),
        )

    merged.update(system_headers)
    return merged


async def deliver_webhook(
    *,
    project_id: UUID,
    #
    delivery_id: UUID,
    subscription_id: UUID,
    event_id: UUID,
    #
    event_type: str,
    #
    url: str,
    headers: dict,
    body: dict,
    #
    encrypted_secret: str,
    #
    retry_count: int,
    #
    dao: WebhooksDAOInterface,
) -> None:
    """Deliver a webhook payload to a single subscriber endpoint."""
    try:
        typed_event_type = WebhookEventType(event_type)
    except ValueError:
        log.warning(
            "[WEBHOOKS TASK] Unrecognized event_type %r — storing None in delivery record",
            event_type,
        )
        typed_event_type = None

    base_data = WebhookDeliveryData(
        event_type=typed_event_type,
        #
        url=url,
        body=body,
    )

    try:
        validate_webhook_url(url)
    except ValueError as e:
        await dao.create_delivery(
            project_id=project_id,
            user_id=None,
            delivery=WebhookDeliveryCreate(
                id=delivery_id,
                subscription_id=subscription_id,
                event_id=event_id,
                status=Status(code="400", message="failed"),
                data=base_data.model_copy(update={"error": str(e)}),
            ),
        )
        return

    signing_secret = decrypt(encrypted_secret)

    payload_json = json.dumps(body, sort_keys=True, separators=(",", ":"))
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    to_sign = f"{timestamp}.{payload_json}"
    signature = hmac.new(
        key=signing_secret.encode("utf-8"),
        msg=to_sign.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()

    system_headers = {
        "Content-Type": "application/json",
        "User-Agent": "Agenta-Webhook/1.0",
        "X-Agenta-Event-Type": event_type,
        "X-Agenta-Delivery-Id": str(delivery_id),
        "X-Agenta-Signature": f"t={timestamp},v1={signature}",
    }
    request_headers = _merge_headers(
        user_headers=headers,
        system_headers=system_headers,
    )
    base_data = base_data.model_copy(update={"headers": request_headers})

    try:
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT) as client:
            response = await client.post(
                url,
                content=payload_json,
                headers=request_headers,
            )

        response_info = WebhookDeliveryResponseInfo(
            status_code=response.status_code,
            body=response.text[:2000],
        )

        final_data = base_data.model_copy(update={"response": response_info})

        if response.is_success:
            # 2xx — record success, task done
            await dao.create_delivery(
                project_id=project_id,
                user_id=None,
                delivery=WebhookDeliveryCreate(
                    id=delivery_id,
                    subscription_id=subscription_id,
                    event_id=event_id,
                    status=Status(code=str(response.status_code), message="success"),
                    data=final_data,
                ),
            )
            return

        if _is_retryable(response.status_code):
            # 5xx — retry; record only on final attempt
            is_last_attempt = retry_count >= WEBHOOK_MAX_RETRIES

            if is_last_attempt:
                await dao.create_delivery(
                    project_id=project_id,
                    user_id=None,
                    delivery=WebhookDeliveryCreate(
                        id=delivery_id,
                        subscription_id=subscription_id,
                        event_id=event_id,
                        status=Status(code=str(response.status_code), message="failed"),
                        data=final_data,
                    ),
                )
            response.raise_for_status()  # triggers TaskIQ retry

        else:
            # 1xx / 3xx / 4xx — permanent failure, no retry
            await dao.create_delivery(
                project_id=project_id,
                user_id=None,
                delivery=WebhookDeliveryCreate(
                    id=delivery_id,
                    subscription_id=subscription_id,
                    event_id=event_id,
                    status=Status(code=str(response.status_code), message="failed"),
                    data=final_data,
                ),
            )

    except httpx.TimeoutException as e:
        is_last_attempt = retry_count >= WEBHOOK_MAX_RETRIES

        if is_last_attempt:
            await dao.create_delivery(
                project_id=project_id,
                user_id=None,
                delivery=WebhookDeliveryCreate(
                    id=delivery_id,
                    subscription_id=subscription_id,
                    event_id=event_id,
                    status=Status(code="0", message="failed"),
                    data=base_data.model_copy(update={"error": f"Timeout: {e}"}),
                ),
            )

        raise

    except httpx.HTTPStatusError:
        # Already handled above via raise_for_status — re-raise for TaskIQ
        raise

    except Exception as e:
        is_last_attempt = retry_count >= WEBHOOK_MAX_RETRIES

        if is_last_attempt:
            await dao.create_delivery(
                project_id=project_id,
                user_id=None,
                delivery=WebhookDeliveryCreate(
                    id=delivery_id,
                    subscription_id=subscription_id,
                    event_id=event_id,
                    status=Status(code="0", message="failed"),
                    data=base_data.model_copy(update={"error": str(e)}),
                ),
            )

        raise
