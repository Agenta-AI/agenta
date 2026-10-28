from unittest.mock import AsyncMock

import httpx
import pytest

from oss.src.core.triggers.exceptions import AdapterError
from oss.src.core.triggers.providers.composio.adapter import (
    ComposioTriggersAdapter,
    normalize_webhook_event,
)


def _status_error(status_code):
    request = httpx.Request("DELETE", "https://backend.composio.dev/trigger")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError(
        f"provider returned {status_code}",
        request=request,
        response=response,
    )


def _adapter_with_delete_error(error):
    adapter = object.__new__(ComposioTriggersAdapter)
    adapter._delete = AsyncMock(side_effect=error)
    return adapter


async def test_delete_subscription_accepts_provider_404_as_already_absent():
    adapter = _adapter_with_delete_error(_status_error(404))

    await adapter.delete_subscription(trigger_id="ti_absent")


@pytest.mark.parametrize(
    "error",
    [
        _status_error(500),
        httpx.ReadTimeout(
            "provider timed out",
            request=httpx.Request("DELETE", "https://backend.composio.dev/trigger"),
        ),
    ],
)
async def test_delete_subscription_propagates_transient_provider_failure(error):
    adapter = _adapter_with_delete_error(error)

    with pytest.raises(AdapterError) as exc_info:
        await adapter.delete_subscription(trigger_id="ti_live")

    assert exc_info.value.operation == "delete_subscription"


def _adapter_with_webhooks(items):
    adapter = object.__new__(ComposioTriggersAdapter)
    adapter._get = AsyncMock(return_value={"items": items})
    adapter._client = AsyncMock()
    return adapter


async def test_ensure_webhook_subscription_returns_existing_secret_and_url():
    adapter = _adapter_with_webhooks(
        [{"secret": "whsec_1", "webhook_url": "https://a.example.org/hook"}]
    )

    registration = await adapter.ensure_webhook_subscription(
        webhook_url="https://b.example.org/hook"
    )

    assert registration.secret == "whsec_1"
    assert registration.webhook_url == "https://a.example.org/hook"
    adapter._client.post.assert_not_awaited()


_V3_ENVELOPE = {
    "id": "msg_1",
    "timestamp": "2026-10-28T10:43:20Z",
    "type": "composio.trigger.message",
    "metadata": {
        "log_id": "log_1",
        "trigger_slug": "GITHUB_PULL_REQUEST_CREATED",
        "trigger_id": "ti_1",
        "connected_account_id": "ca_1",
        "auth_config_id": "ac_1",
        "user_id": "u_1",
    },
    "data": {"number": 7},
}


def test_normalize_webhook_event_maps_v3_envelope():
    event = normalize_webhook_event(_V3_ENVELOPE)

    assert event["metadata"]["id"] == "msg_1"
    assert event["metadata"]["trigger_id"] == "ti_1"
    assert event["metadata"]["trigger_slug"] == "GITHUB_PULL_REQUEST_CREATED"
    assert event["payload"] == {"number": 7}


@pytest.mark.parametrize(
    "envelope",
    [
        {**_V3_ENVELOPE, "type": "composio.connected_account.expired"},
        {k: v for k, v in _V3_ENVELOPE.items() if k != "id"},
        {**_V3_ENVELOPE, "metadata": {"trigger_slug": "X"}},
    ],
)
def test_normalize_webhook_event_rejects_unroutable_envelopes(envelope):
    assert normalize_webhook_event(envelope) is None
