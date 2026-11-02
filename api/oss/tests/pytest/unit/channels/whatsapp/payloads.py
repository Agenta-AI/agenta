"""Meta-shaped WhatsApp Cloud API webhook bodies, built the way Meta sends
them: `entry[].changes[].value` with `metadata`, `contacts`, and `messages`
or `statuses`."""

import hashlib
import hmac
import json
from typing import Any

PHONE_NUMBER_ID = "106540352242922"
OTHER_PHONE_NUMBER_ID = "106540352242999"
WABA_ID = "102290129340398"
CUSTOMER = "16315551234"
APP_SECRET = "fake-app-secret-not-real"
ACCESS_TOKEN = "EAAfake-system-user-token"


def _value(
    *,
    phone_number_id: str = PHONE_NUMBER_ID,
    messages: list[dict[str, Any]] | None = None,
    statuses: list[dict[str, Any]] | None = None,
    name: str = "Kerry Fisher",
    wa_id: str = CUSTOMER,
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "messaging_product": "whatsapp",
        "metadata": {
            "display_phone_number": "15550100000",
            "phone_number_id": phone_number_id,
        },
    }
    if messages is not None:
        value["contacts"] = [{"profile": {"name": name}, "wa_id": wa_id}]
        value["messages"] = messages
    if statuses is not None:
        value["statuses"] = statuses
    return value


def body(*values: dict[str, Any], entries: int = 1) -> dict[str, Any]:
    """One entry holding every value as its own change; `entries` > 1 spreads
    them one per entry, the batched shape."""

    changes = [{"field": "messages", "value": value} for value in values]
    if entries == 1:
        return {
            "object": "whatsapp_business_account",
            "entry": [{"id": WABA_ID, "changes": changes}],
        }
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": WABA_ID, "changes": [change]} for change in changes],
    }


def text_message(
    text: str = "Hi, is my order 4411 shipped?",
    *,
    message_id: str = "wamid.HBgLMTYzMTU1NTEyMzQVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
    wa_id: str = CUSTOMER,
    timestamp: str = "1758700000",
) -> dict[str, Any]:
    return {
        "from": wa_id,
        "id": message_id,
        "timestamp": timestamp,
        "type": "text",
        "text": {"body": text},
    }


def button_reply(token: str, *, title: str = "Approve", message_id: str = "wamid.tap1"):
    return {
        "context": {"from": "15550100000", "id": "wamid.out.1"},
        "from": CUSTOMER,
        "id": message_id,
        "timestamp": "1758700100",
        "type": "interactive",
        "interactive": {
            "type": "button_reply",
            "button_reply": {"id": token, "title": title},
        },
    }


def list_reply(token: str, *, title: str = "Option 4", message_id: str = "wamid.pick1"):
    return {
        "context": {"from": "15550100000", "id": "wamid.out.2"},
        "from": CUSTOMER,
        "id": message_id,
        "timestamp": "1758700200",
        "type": "interactive",
        "interactive": {
            "type": "list_reply",
            "list_reply": {"id": token, "title": title, "description": ""},
        },
    }


def media_message(
    kind: str,
    *,
    media_id: str = "1037543291543636",
    mime_type: str = "application/pdf",
    caption: str | None = None,
    filename: str | None = None,
    message_id: str = "wamid.media1",
):
    media: dict[str, Any] = {"id": media_id, "mime_type": mime_type, "sha256": "x"}
    if caption:
        media["caption"] = caption
    if filename:
        media["filename"] = filename
    return {
        "from": CUSTOMER,
        "id": message_id,
        "timestamp": "1758700300",
        "type": kind,
        kind: media,
    }


def failed_status(message_id: str = "wamid.out.1", code: int = 131047):
    return {
        "id": message_id,
        "status": "failed",
        "timestamp": "1758700400",
        "recipient_id": CUSTOMER,
        "errors": [{"code": code, "title": "Re-engagement message"}],
    }


def delivered_status(message_id: str = "wamid.out.1"):
    return {
        "id": message_id,
        "status": "delivered",
        "timestamp": "1758700400",
        "recipient_id": CUSTOMER,
    }


def encode(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload).encode()


def sign(raw: bytes, secret: str = APP_SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def text_body(text: str = "Hi, is my order 4411 shipped?", **kwargs) -> dict[str, Any]:
    return body(_value(messages=[text_message(text, **kwargs)]))


value = _value
