from unittest.mock import AsyncMock

import httpx
import pytest

from oss.src.core.triggers.exceptions import AdapterError
from oss.src.core.triggers.providers.composio.adapter import ComposioTriggersAdapter


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
