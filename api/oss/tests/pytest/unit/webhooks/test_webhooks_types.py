"""Unit tests for events/webhooks type invariants.

Pure logic, no network or database involved.
"""

import string
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from oss.src.core.events.types import EventType
from oss.src.core.shared.dtos import Status
from oss.src.core.webhooks.exceptions import WebhookSubscriptionNotFoundError
from oss.src.core.webhooks.types import (
    WEBHOOK_MAX_RETRIES,
    WEBHOOK_TIMEOUT,
    WebhookDelivery,
    WebhookDeliveryData,
    WebhookEventType,
    WebhookSubscriptionCreate,
    WebhookSubscriptionData,
    WebhookSubscriptionEdit,
)
from oss.src.core.webhooks.service import WebhooksService


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ---------------------------------------------------------------------------
# WebhookEventType is a strict subset of EventType
# ---------------------------------------------------------------------------


def test_webhook_event_types_are_subset_of_event_types():
    event_type_values = {e.value for e in EventType}
    webhook_event_type_values = {e.value for e in WebhookEventType}

    assert webhook_event_type_values.issubset(event_type_values), (
        "Every WebhookEventType value must exist in EventType"
    )


def test_webhook_event_type_values_helper():
    values = WebhookEventType.values()
    assert isinstance(values, list)
    assert len(values) == len(WebhookEventType)
    for v in values:
        assert isinstance(v, str)


# ---------------------------------------------------------------------------
# Configuration constants are sane
# ---------------------------------------------------------------------------


def test_webhook_configuration_constants():
    assert WEBHOOK_MAX_RETRIES > 0
    assert WEBHOOK_TIMEOUT > 0


# ---------------------------------------------------------------------------
# _generate_secret produces a 32-char alphanumeric string
# ---------------------------------------------------------------------------


def test_generate_secret_length_and_charset():
    from unittest.mock import MagicMock

    service = WebhooksService(
        webhooks_dao=MagicMock(),
        vault_service=MagicMock(),
    )

    allowed = set(string.ascii_letters + string.digits)
    for _ in range(10):
        secret = service._generate_secret()
        assert len(secret) == 32, "Secret must be exactly 32 characters"
        assert set(secret).issubset(allowed), "Secret must be alphanumeric"


def test_generate_secret_is_random():
    service = WebhooksService(
        webhooks_dao=MagicMock(),
        vault_service=MagicMock(),
    )

    secrets = {service._generate_secret() for _ in range(20)}
    assert len(secrets) > 1, "Repeated calls should produce different secrets"


@pytest.mark.anyio
async def test_test_subscription_persists_delivery_for_saved_subscription():
    project_id = uuid4()
    user_id = uuid4()
    subscription_id = uuid4()
    secret_id = uuid4()

    dao = MagicMock()
    dao.fetch_subscription = AsyncMock(return_value=SimpleNamespace(secret_id=secret_id))

    expected_delivery = WebhookDelivery(
        id=uuid4(),
        created_at=None,
        updated_at=None,
        deleted_at=None,
        created_by_id=None,
        updated_by_id=None,
        deleted_by_id=None,
        subscription_id=subscription_id,
        event_id=uuid4(),
        status=Status(code="200", message="success"),
        data=WebhookDeliveryData(url="https://example.com/webhook"),
    )
    dao.create_delivery = AsyncMock(return_value=expected_delivery)

    service = WebhooksService(
        webhooks_dao=dao,
        vault_service=MagicMock(),
    )
    service._resolve_secret = AsyncMock(return_value="persisted-secret")  # type: ignore[attr-defined]

    subscription = WebhookSubscriptionEdit(
        id=subscription_id,
        name="Saved webhook",
        data=WebhookSubscriptionData(
            url="https://example.com/webhook",
            auth_mode="signature",
        ),
    )

    prepared = SimpleNamespace(
        payload_json="{}",
        request_headers={"content-type": "application/json"},
        data=WebhookDeliveryData(url="https://example.com/webhook"),
    )
    response = SimpleNamespace(status_code=200, text="ok", is_success=True)

    with patch(
        "oss.src.core.webhooks.service.prepare_webhook_request",
        return_value=prepared,
    ), patch(
        "oss.src.core.webhooks.service.send_webhook_request",
        AsyncMock(return_value=response),
    ):
        result = await service.test_subscription(
            project_id=project_id,
            user_id=user_id,
            subscription=subscription,
        )

    assert result == expected_delivery
    dao.create_delivery.assert_awaited_once()
    call_kwargs = dao.create_delivery.await_args.kwargs
    assert call_kwargs["project_id"] == project_id
    assert call_kwargs["user_id"] == user_id
    assert call_kwargs["delivery"].subscription_id == subscription_id
    assert call_kwargs["delivery"].status.code == "200"
    service._resolve_secret.assert_awaited_once_with(project_id=project_id, secret_id=secret_id)  # type: ignore[attr-defined]


@pytest.mark.anyio
async def test_test_subscription_raises_when_saved_subscription_missing():
    subscription_id = uuid4()

    dao = MagicMock()
    dao.fetch_subscription = AsyncMock(return_value=None)

    service = WebhooksService(
        webhooks_dao=dao,
        vault_service=MagicMock(),
    )

    subscription = WebhookSubscriptionEdit(
        id=subscription_id,
        name="Missing webhook",
        data=WebhookSubscriptionData(url="https://example.com/webhook"),
    )

    with pytest.raises(WebhookSubscriptionNotFoundError):
        await service.test_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=subscription,
        )


@pytest.mark.anyio
async def test_test_subscription_raises_when_saved_subscription_missing_even_with_secret():
    subscription_id = uuid4()

    dao = MagicMock()
    dao.fetch_subscription = AsyncMock(return_value=None)

    service = WebhooksService(
        webhooks_dao=dao,
        vault_service=MagicMock(),
    )

    subscription = WebhookSubscriptionEdit(
        id=subscription_id,
        name="Missing webhook",
        secret="provided-secret",
        data=WebhookSubscriptionData(url="https://example.com/webhook"),
    )

    with pytest.raises(WebhookSubscriptionNotFoundError):
        await service.test_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=subscription,
        )


@pytest.mark.anyio
async def test_test_subscription_does_not_persist_for_new_subscription():
    dao = MagicMock()
    dao.fetch_subscription = AsyncMock()
    dao.create_delivery = AsyncMock()

    service = WebhooksService(
        webhooks_dao=dao,
        vault_service=MagicMock(),
    )

    subscription = WebhookSubscriptionCreate(
        name="Draft webhook",
        data=WebhookSubscriptionData(url="https://example.com/webhook"),
    )

    prepared = SimpleNamespace(
        payload_json="{}",
        request_headers={"content-type": "application/json"},
        data=WebhookDeliveryData(url="https://example.com/webhook"),
    )
    response = SimpleNamespace(status_code=200, text="ok", is_success=True)

    with patch(
        "oss.src.core.webhooks.service.prepare_webhook_request",
        return_value=prepared,
    ), patch(
        "oss.src.core.webhooks.service.send_webhook_request",
        AsyncMock(return_value=response),
    ):
        result = await service.test_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=subscription,
        )

    assert result.subscription_id == UUID(int=0)
    dao.fetch_subscription.assert_not_awaited()
    dao.create_delivery.assert_not_awaited()
