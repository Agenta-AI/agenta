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

from typing import Any, Dict, Optional
from uuid import UUID

import httpx

from oss.src.core.shared.dtos import Status
from oss.src.core.webhooks.delivery import (
    PreparedWebhookRequestError,
    prepare_webhook_request,
    send_webhook_request,
)
from oss.src.core.webhooks.types import (
    WEBHOOK_MAX_RETRIES,
    WebhookDeliveryCreate,
    WebhookDeliveryResponseInfo,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _is_retryable(status_code: int) -> bool:
    return status_code >= 500


def _log_response(
    response: httpx.Response,
    *,
    delivery_id: UUID,
    url: str,
) -> None:
    status = response.status_code
    body_preview = response.text[:500]

    if 100 <= status < 200 or 200 <= status < 300:
        # log.debug(
        #     "[WEBHOOKS TASK] %d from %s delivery=%s body=%s",
        #     status, url, delivery_id, body_preview,
        # )
        pass
    elif 300 <= status < 400:
        log.warning(
            "[WEBHOOKS TASK] %d from %s delivery=%s body=%s",
            status,
            url,
            delivery_id,
            body_preview,
        )
    else:
        log.error(
            "[WEBHOOKS TASK] %d from %s delivery=%s body=%s",
            status,
            url,
            delivery_id,
            body_preview,
        )


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
    payload_fields: Optional[Dict[str, Any]],
    auth_mode: Optional[str],
    #
    event: Dict[str, Any],
    subscription: Dict[str, Any],
    #
    encrypted_secret: str,
    #
    retry_count: int,
    #
    dao: WebhooksDAOInterface,
) -> None:
    """Deliver a webhook payload to a single subscriber endpoint."""
    try:
        prepared = prepare_webhook_request(
            project_id=project_id,
            delivery_id=delivery_id,
            event_id=event_id,
            event_type=event_type,
            url=url,
            headers=headers,
            payload_fields=payload_fields,
            auth_mode=auth_mode,
            event=event,
            subscription=subscription,
            encrypted_secret=encrypted_secret,
        )
    except PreparedWebhookRequestError as e:
        await dao.create_delivery(
            project_id=project_id,
            user_id=None,
            delivery=WebhookDeliveryCreate(
                id=delivery_id,
                subscription_id=subscription_id,
                event_id=event_id,
                status=Status(code="400", message="failed"),
                data=e.data.model_copy(update={"error": str(e)}),
            ),
        )
        return

    try:
        response = await send_webhook_request(
            url=url,
            payload_json=prepared.payload_json,
            headers=prepared.request_headers,
        )

        response_info = WebhookDeliveryResponseInfo(
            status_code=response.status_code,
            body=response.text[:2000],
        )

        _log_response(response, delivery_id=delivery_id, url=url)

        final_data = prepared.data.model_copy(update={"response": response_info})

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
                    data=prepared.data.model_copy(update={"error": f"Timeout: {e}"}),
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
                    data=prepared.data.model_copy(update={"error": str(e)}),
                ),
            )

        raise
