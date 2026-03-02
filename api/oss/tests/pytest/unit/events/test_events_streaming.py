"""Unit tests for core/events/streaming.py — deserialize_event.

Pure deserialization logic; no Redis or network required.
"""

from uuid import UUID

from orjson import dumps

from oss.src.core.events.streaming import deserialize_event
from oss.src.core.events.types import EventType, RequestType


_ORG_ID = "11111111-1111-1111-1111-111111111111"
_PROJECT_ID = "22222222-2222-2222-2222-222222222222"
_REQUEST_ID = "33333333-3333-3333-3333-333333333333"
_EVENT_ID = "44444444-4444-4444-4444-444444444444"
_USER_ID = "55555555-5555-5555-5555-555555555555"
_TIMESTAMP = "2024-06-01T12:00:00+00:00"


def _encode(obj: dict) -> bytes:
    import zlib

    return zlib.compress(dumps(obj))


# ---------------------------------------------------------------------------
# Modern format — "event" key is present at root
# ---------------------------------------------------------------------------


def test_deserialize_modern_format():
    payload = _encode(
        {
            "organization_id": _ORG_ID,
            "project_id": _PROJECT_ID,
            "event": {
                "request_id": _REQUEST_ID,
                "event_id": _EVENT_ID,
                "request_type": RequestType.UNKNOWN.value,
                "event_type": EventType.WEBHOOKS_SUBSCRIPTIONS_TESTED.value,
                "timestamp": _TIMESTAMP,
            },
        }
    )

    msg = deserialize_event(payload=payload)

    assert msg.project_id == UUID(_PROJECT_ID)
    assert msg.organization_id == UUID(_ORG_ID)
    assert msg.event.request_id == UUID(_REQUEST_ID)
    assert msg.event.event_id == UUID(_EVENT_ID)
    assert msg.event.event_type == EventType.WEBHOOKS_SUBSCRIPTIONS_TESTED
    assert msg.event.request_type == RequestType.UNKNOWN


def test_deserialize_modern_format_without_org():
    payload = _encode(
        {
            "organization_id": None,
            "project_id": _PROJECT_ID,
            "event": {
                "request_id": _REQUEST_ID,
                "event_id": _EVENT_ID,
                "request_type": RequestType.UNKNOWN.value,
                "event_type": EventType.UNKNOWN.value,
                "timestamp": _TIMESTAMP,
            },
        }
    )

    msg = deserialize_event(payload=payload)

    assert msg.organization_id is None
    assert msg.project_id == UUID(_PROJECT_ID)


# ---------------------------------------------------------------------------
# Legacy flat format — event fields are mixed in at root level
# ---------------------------------------------------------------------------


def test_deserialize_legacy_flat_format():
    """Legacy messages have no nested 'event' key; scope and event fields are flat."""
    payload = _encode(
        {
            "organization_id": _ORG_ID,
            "project_id": _PROJECT_ID,
            "user_id": _USER_ID,
            "request_id": _REQUEST_ID,
            "event_id": _EVENT_ID,
            "request_type": RequestType.UNKNOWN.value,
            "event_type": EventType.ENVIRONMENTS_REVISIONS_COMMITTED.value,
            "timestamp": _TIMESTAMP,
        }
    )

    msg = deserialize_event(payload=payload)

    assert msg.project_id == UUID(_PROJECT_ID)
    assert msg.organization_id == UUID(_ORG_ID)
    assert msg.event.request_id == UUID(_REQUEST_ID)
    assert msg.event.event_id == UUID(_EVENT_ID)
    assert msg.event.event_type == EventType.ENVIRONMENTS_REVISIONS_COMMITTED


def test_deserialize_legacy_format_discards_user_id():
    """user_id at root level must be silently dropped — it's not part of Event."""
    payload = _encode(
        {
            "project_id": _PROJECT_ID,
            "user_id": _USER_ID,
            "request_id": _REQUEST_ID,
            "event_id": _EVENT_ID,
            "request_type": RequestType.UNKNOWN.value,
            "event_type": EventType.UNKNOWN.value,
            "timestamp": _TIMESTAMP,
        }
    )

    msg = deserialize_event(payload=payload)

    # user_id must not end up on the event object
    assert not hasattr(msg.event, "user_id")
    assert msg.event.request_id == UUID(_REQUEST_ID)


def test_deserialize_legacy_format_without_org():
    payload = _encode(
        {
            "project_id": _PROJECT_ID,
            "request_id": _REQUEST_ID,
            "event_id": _EVENT_ID,
            "request_type": RequestType.UNKNOWN.value,
            "event_type": EventType.UNKNOWN.value,
            "timestamp": _TIMESTAMP,
        }
    )

    msg = deserialize_event(payload=payload)

    assert msg.organization_id is None
    assert msg.project_id == UUID(_PROJECT_ID)


# ---------------------------------------------------------------------------
# to_event helper
# ---------------------------------------------------------------------------


def test_to_event_returns_event_object():
    payload = _encode(
        {
            "project_id": _PROJECT_ID,
            "event": {
                "request_id": _REQUEST_ID,
                "event_id": _EVENT_ID,
                "request_type": RequestType.UNKNOWN.value,
                "event_type": EventType.UNKNOWN.value,
                "timestamp": _TIMESTAMP,
            },
        }
    )

    msg = deserialize_event(payload=payload)
    event = msg.to_event()

    assert event.event_id == UUID(_EVENT_ID)
    assert event.request_id == UUID(_REQUEST_ID)
