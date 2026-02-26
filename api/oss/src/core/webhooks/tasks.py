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
from uuid import UUID

import httpx

from oss.src.core.shared.dtos import Status
from oss.src.core.webhooks.config import WEBHOOK_MAX_RETRIES, WEBHOOK_TIMEOUT
from oss.src.core.webhooks.dtos import (
    WebhookDeliveryCreate,
    WebhookDeliveryData,
    WebhookDeliveryResponseInfo,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.utils.crypting import decrypt
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _is_retryable(status_code: int) -> bool:
    return status_code >= 500


async def _record_delivery(
    *,
    dao: WebhooksDAOInterface,
    project_id: UUID,
    subscription_id: UUID,
    event_id: UUID,
    status: Status,
    data: WebhookDeliveryData,
) -> None:
    try:
        await dao.create_delivery(
            project_id=project_id,
            user_id=None,
            delivery=WebhookDeliveryCreate(
                status=status,
                data=data,
                subscription_id=subscription_id,
                event_id=event_id,
            ),
        )
    except Exception as e:
        log.error(f"[WEBHOOKS TASK] Failed to record delivery: {e}")


async def deliver_webhook(
    *,
    project_id: UUID,
    subscription_id: UUID,
    event_id: UUID,
    #
    url: str,
    headers: dict,
    encrypted_secret: str,
    #
    event_type: str,
    payload: dict,
    #
    retry_count: int,
    #
    dao: WebhooksDAOInterface,
) -> None:
    """Deliver a webhook payload to a single subscriber endpoint."""
    signing_secret = decrypt(encrypted_secret)

    payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    to_sign = f"{timestamp}.{payload_json}"
    signature = hmac.new(
        key=signing_secret.encode("utf-8"),
        msg=to_sign.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()

    request_headers = {
        "Content-Type": "application/json",
        "User-Agent": "Agenta-Webhook/1.0",
        "X-Agenta-Event-Type": event_type,
        "X-Agenta-Signature": f"t={timestamp},v1={signature}",
    }
    request_headers.update(headers)

    base_data = WebhookDeliveryData(
        url=url,  # type: ignore[arg-type]
        event_type=event_type,
        payload=payload,
    )

    try:
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT) as client:
            start_time = datetime.now(timezone.utc)
            response = await client.post(
                url,
                content=payload_json,
                headers=request_headers,
            )
            duration_ms = int(
                (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            )

        response_info = WebhookDeliveryResponseInfo(
            status_code=response.status_code,
            body=response.text[:2000],
        )
        final_data = base_data.model_copy(
            update={"duration_ms": duration_ms, "response": response_info}
        )

        if response.is_success:
            # 2xx — record success, task done
            await _record_delivery(
                dao=dao,
                project_id=project_id,
                subscription_id=subscription_id,
                event_id=event_id,
                status=Status(code=response.status_code, message="success"),
                data=final_data,
            )
            return

        if _is_retryable(response.status_code):
            # 5xx — retry; record only on final attempt
            is_last_attempt = retry_count >= WEBHOOK_MAX_RETRIES
            if is_last_attempt:
                await _record_delivery(
                    dao=dao,
                    project_id=project_id,
                    subscription_id=subscription_id,
                    event_id=event_id,
                    status=Status(code=response.status_code, message="failed"),
                    data=final_data,
                )
            response.raise_for_status()  # triggers TaskIQ retry

        else:
            # 1xx / 3xx / 4xx — permanent failure, no retry
            await _record_delivery(
                dao=dao,
                project_id=project_id,
                subscription_id=subscription_id,
                event_id=event_id,
                status=Status(code=response.status_code, message="failed"),
                data=final_data,
            )

    except httpx.TimeoutException as e:
        is_last_attempt = retry_count >= WEBHOOK_MAX_RETRIES
        if is_last_attempt:
            await _record_delivery(
                dao=dao,
                project_id=project_id,
                subscription_id=subscription_id,
                event_id=event_id,
                status=Status(code=0, message="failed"),
                data=base_data.model_copy(update={"error": f"Timeout: {e}"}),
            )
        raise

    except httpx.HTTPStatusError:
        # Already handled above via raise_for_status — re-raise for TaskIQ
        raise

    except Exception as e:
        is_last_attempt = retry_count >= WEBHOOK_MAX_RETRIES
        if is_last_attempt:
            await _record_delivery(
                dao=dao,
                project_id=project_id,
                subscription_id=subscription_id,
                event_id=event_id,
                status=Status(code=0, message="failed"),
                data=base_data.model_copy(update={"error": str(e)}),
            )
        raise
