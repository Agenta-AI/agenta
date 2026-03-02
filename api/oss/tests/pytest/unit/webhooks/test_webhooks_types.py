"""Unit tests for events/webhooks type invariants.

Pure logic, no network or database involved.
"""

import string

from oss.src.core.events.types import EventType
from oss.src.core.webhooks.types import (
    WEBHOOK_MAX_RETRIES,
    WEBHOOK_TEST_MAX_ATTEMPTS,
    WEBHOOK_TEST_POLL_INTERVAL_MS,
    WEBHOOK_TIMEOUT,
    WebhookEventType,
    WebhookSubscriptionFlags,
)
from oss.src.core.webhooks.service import WebhooksService


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
# Default flags
# ---------------------------------------------------------------------------


def test_webhook_subscription_default_flags():
    flags = WebhookSubscriptionFlags()
    assert flags.is_active is True
    assert flags.is_valid is False


# ---------------------------------------------------------------------------
# Configuration constants are sane
# ---------------------------------------------------------------------------


def test_webhook_configuration_constants():
    assert WEBHOOK_MAX_RETRIES > 0
    assert WEBHOOK_TIMEOUT > 0
    assert WEBHOOK_TEST_POLL_INTERVAL_MS > 0
    assert WEBHOOK_TEST_MAX_ATTEMPTS > 0


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
    from unittest.mock import MagicMock

    service = WebhooksService(
        webhooks_dao=MagicMock(),
        vault_service=MagicMock(),
    )

    secrets = {service._generate_secret() for _ in range(20)}
    assert len(secrets) > 1, "Repeated calls should produce different secrets"
