import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID

import httpx

from agenta.sdk.utils.resolvers import resolve_json_selector

from oss.src.core.webhooks.types import (
    EVENT_CONTEXT_FIELDS,
    SUBSCRIPTION_CONTEXT_FIELDS,
    WEBHOOK_TIMEOUT,
    WebhookDeliveryData,
    WebhookEventType,
)
from oss.src.core.webhooks.utils import validate_webhook_url
from oss.src.utils.crypting import decrypt
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

MAX_RESOLVE_DEPTH = 10

NON_OVERRIDABLE_HEADERS = {
    "content-type",
    "content-length",
    "host",
    "user-agent",
    "x-agenta-event-type",
    "x-agenta-delivery-id",
    "x-agenta-event-id",
    "x-agenta-signature",
    "idempotency-key",
    "authorization",
}

REDACTED_HEADERS = {
    "authorization",
    "x-agenta-signature",
}

REDACTED_VALUE = "[REDACTED]"


@dataclass
class PreparedWebhookRequest:
    typed_event_type: Optional[WebhookEventType]
    data: WebhookDeliveryData
    payload_json: str
    request_headers: dict[str, str]


class PreparedWebhookRequestError(ValueError):
    def __init__(self, message: str, *, data: WebhookDeliveryData):
        super().__init__(message)
        self.data = data


def _redact_headers(headers: dict[str, str]) -> dict[str, str]:
    return {
        key: (REDACTED_VALUE if key.lower() in REDACTED_HEADERS else value)
        for key, value in headers.items()
    }


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
            "[WEBHOOKS DELIVERY] Dropped non-overwritable user headers: %s",
            ", ".join(sorted(set(dropped))),
        )

    merged.update(system_headers)
    return merged


def resolve_payload_fields(
    fields: Any,
    context: Dict[str, Any],
    *,
    _depth: int = 0,
) -> Any:
    if _depth > MAX_RESOLVE_DEPTH:
        return None
    if isinstance(fields, dict):
        return {
            k: resolve_payload_fields(v, context, _depth=_depth + 1)
            for k, v in fields.items()
        }
    if isinstance(fields, list):
        return [
            resolve_payload_fields(item, context, _depth=_depth + 1) for item in fields
        ]
    try:
        return resolve_json_selector(fields, context)
    except Exception:
        return None


def prepare_webhook_request(
    *,
    project_id: UUID,
    delivery_id: UUID,
    event_id: UUID,
    event_type: str,
    url: str,
    headers: dict,
    payload_fields: Optional[Dict[str, Any]],
    auth_mode: Optional[str],
    event: Dict[str, Any],
    subscription: Dict[str, Any],
    encrypted_secret: str,
) -> PreparedWebhookRequest:
    try:
        typed_event_type = WebhookEventType(event_type)
    except ValueError:
        log.warning(
            "[WEBHOOKS DELIVERY] Unrecognized event_type %r — storing None in delivery data",
            event_type,
        )
        typed_event_type = None

    context = {
        "event": {k: v for k, v in event.items() if k in EVENT_CONTEXT_FIELDS},
        "subscription": {
            k: v for k, v in subscription.items() if k in SUBSCRIPTION_CONTEXT_FIELDS
        },
        "scope": {"project_id": str(project_id)},
    }

    resolved_fields = payload_fields if payload_fields is not None else "$"
    payload = resolve_payload_fields(resolved_fields, context)

    base_data = WebhookDeliveryData(
        event_type=typed_event_type,
        url=url,
        payload=payload,
    )

    try:
        validate_webhook_url(url)
    except ValueError as exc:
        raise PreparedWebhookRequestError(str(exc), data=base_data) from exc

    signing_secret = decrypt(encrypted_secret)
    resolved_auth_mode = auth_mode or "signature"
    payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))

    if resolved_auth_mode == "authorization":
        system_headers = {
            "Content-Type": "application/json",
            "User-Agent": "Agenta-Webhook/1.0",
            "X-Agenta-Event-Type": event_type,
            "X-Agenta-Delivery-Id": str(delivery_id),
            "X-Agenta-Event-Id": str(event_id),
            "Idempotency-Key": str(delivery_id),
            "Authorization": signing_secret,
        }
    else:
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
            "X-Agenta-Event-Id": str(event_id),
            "Idempotency-Key": str(delivery_id),
            "X-Agenta-Signature": f"t={timestamp},v1={signature}",
        }

    request_headers = _merge_headers(
        user_headers=headers,
        system_headers=system_headers,
    )

    return PreparedWebhookRequest(
        typed_event_type=typed_event_type,
        data=base_data.model_copy(update={"headers": _redact_headers(request_headers)}),
        payload_json=payload_json,
        request_headers=request_headers,
    )


async def send_webhook_request(
    *,
    url: str,
    payload_json: str,
    headers: dict[str, str],
) -> httpx.Response:
    async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT) as client:
        return await client.post(
            url,
            content=payload_json,
            headers=headers,
        )
