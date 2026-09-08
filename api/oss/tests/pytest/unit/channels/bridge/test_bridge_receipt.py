from datetime import datetime, timezone

import pytest

from oss.src.core.channels.adapters.bridge.receipt import (
    BridgeDeliveryFailed,
    read_delivery_response,
)
from oss.src.core.channels.utils import compose_idempotency_key
from uuid import uuid4


def test_post_then_edit_of_the_same_row_send_two_distinct_idempotency_keys():
    key = uuid4()

    post_token = compose_idempotency_key(key=key, updated_at=None)
    edit_token = compose_idempotency_key(
        key=key, updated_at=datetime(2026, 7, 20, tzinfo=timezone.utc)
    )

    assert post_token != edit_token


def test_unmodified_retry_resends_the_identical_idempotency_key():
    key = uuid4()
    updated_at = datetime(2026, 7, 20, tzinfo=timezone.utc)

    first = compose_idempotency_key(key=key, updated_at=updated_at)
    retry = compose_idempotency_key(key=key, updated_at=updated_at)

    assert first == retry


def test_slack_shaped_and_discord_shaped_locators_both_round_trip_opaquely():
    slack_shaped = {
        "type": "bridge.receipt",
        "external_locator": {"channel": "C1", "ts": "123.4"},
    }
    discord_shaped = {
        "type": "bridge.receipt",
        "external_locator": {"channel_id": "999", "message_id": "1000"},
    }

    assert read_delivery_response(slack_shaped) == {"channel": "C1", "ts": "123.4"}
    assert read_delivery_response(discord_shaped) == {
        "channel_id": "999",
        "message_id": "1000",
    }


def test_explicit_bridge_reported_failure_surfaces_as_a_failure():
    with pytest.raises(BridgeDeliveryFailed):
        read_delivery_response({"type": "bridge.receipt", "error": "rate_limited"})


def test_a_response_that_is_not_a_receipt_at_all_also_fails_rather_than_silently_succeeding():
    with pytest.raises(BridgeDeliveryFailed):
        read_delivery_response({"type": "something.else"})
