"""Unit tests for the L2 `Counter.EVENTS_INGESTED` enforcement in
`EventsWorker.process_batch`.

These mirror the L1 tests in `test_events_utils.py` but exercise the
authoritative server-side check + adjust path that runs in the events
worker. They do not touch Redis or the database — `process_batch` is
called directly with synthetic Redis-stream payloads, and the
entitlements helpers are patched.

Note: feature-gating (audit-log access) is intentionally NOT enforced
at ingest; only the counter quota is. The audit flag lives at the
query side (`POST /events/query`).
"""

import zlib
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Tuple
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import orjson as json_lib
import pytest

from oss.src.core.events.dtos import Event
from oss.src.core.events.types import EventType, RequestType
from oss.src.tasks.asyncio.events.worker import EventsWorker


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _make_worker(ingest_return: int = 0) -> EventsWorker:
    """Construct an `EventsWorker` without touching Redis or the DB."""
    worker = EventsWorker.__new__(EventsWorker)
    worker.service = SimpleNamespace(ingest=AsyncMock(return_value=ingest_return))
    worker.redis = None
    worker.stream_name = "test:events"
    worker.consumer_group = "test-group"
    worker.consumer_name = "test-consumer"
    worker.max_batch_size = 50
    worker.max_block_ms = 100
    worker.max_batch_mb = 50
    worker.max_delay_ms = 50
    worker.webhooks_dispatcher = None
    return worker


def _make_event_message(
    *,
    organization_id: UUID,
    project_id: UUID,
    event_type: EventType = EventType.TRACES_FETCHED,
) -> bytes:
    """Build a zlib-compressed wire payload matching `EventMessage`."""
    event = Event(
        request_id=uuid4(),
        event_id=uuid4(),
        request_type=RequestType.UNKNOWN,
        event_type=event_type,
        timestamp=datetime.now(timezone.utc),
        attributes={"user_id": str(uuid4()), "count": 1},
    )
    message = {
        "organization_id": str(organization_id),
        "project_id": str(project_id),
        "event": event.model_dump(mode="json"),
    }
    payload = json_lib.dumps(message)
    return zlib.compress(payload)


def _make_batch(
    payloads: List[bytes],
) -> List[Tuple[bytes, Dict[bytes, bytes]]]:
    return [
        (f"msg-{i}".encode(), {b"data": payload}) for i, payload in enumerate(payloads)
    ]


# ---------------------------------------------------------------------------
# Patch shims for EE entitlements
#
# `EventsWorker` imports `check_entitlements`, `scope_from`, and
# `Counter` at module top under `if is_ee():`. The OSS test runner has
# `is_ee()` False, so those imports never happened. We attach our fakes
# to the worker module namespace and toggle the module-level `is_ee`.
# ---------------------------------------------------------------------------


class _FakeCounter:
    EVENTS_INGESTED = "events_ingested"


def _fake_scope_from(*, organization_id=None, **_kwargs):
    return {"organization_id": organization_id}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_l2_allows_under_quota_and_ingests_org_batch():
    """check_entitlements(EVENTS_INGESTED) returns allowed → events ingested."""
    org_id = uuid4()
    proj_id = uuid4()
    payload = _make_event_message(organization_id=org_id, project_id=proj_id)
    batch = _make_batch([payload, payload])

    worker = _make_worker(ingest_return=2)

    calls: List[Dict[str, Any]] = []

    async def _fake_check(**kwargs):
        calls.append(kwargs)
        return True, None, None

    with (
        patch("oss.src.tasks.asyncio.events.worker.is_ee", return_value=True),
        patch(
            "oss.src.tasks.asyncio.events.worker.check_entitlements",
            new=_fake_check,
            create=True,
        ),
        patch(
            "oss.src.tasks.asyncio.events.worker.scope_from",
            new=_fake_scope_from,
            create=True,
        ),
        patch(
            "oss.src.tasks.asyncio.events.worker.Counter",
            new=_FakeCounter,
            create=True,
        ),
    ):
        total, processed_ids, allowed = await worker.process_batch(batch)

    assert total == 2
    assert len(processed_ids) == 2
    assert len(allowed) == 1
    # Exactly one entitlements call: the Counter quota check.
    assert len(calls) == 1
    assert calls[0]["key"] == _FakeCounter.EVENTS_INGESTED
    assert calls[0]["delta"] == 2
    worker.service.ingest.assert_awaited_once()


@pytest.mark.asyncio
async def test_l2_over_quota_drops_org_batch():
    """check_entitlements(EVENTS_INGESTED) returns not-allowed → events dropped."""
    org_id = uuid4()
    proj_id = uuid4()
    payload = _make_event_message(organization_id=org_id, project_id=proj_id)
    batch = _make_batch([payload, payload, payload])

    worker = _make_worker()

    async def _fake_check(**kwargs):
        return False, None, None

    with (
        patch("oss.src.tasks.asyncio.events.worker.is_ee", return_value=True),
        patch(
            "oss.src.tasks.asyncio.events.worker.check_entitlements",
            new=_fake_check,
            create=True,
        ),
        patch(
            "oss.src.tasks.asyncio.events.worker.scope_from",
            new=_fake_scope_from,
            create=True,
        ),
        patch(
            "oss.src.tasks.asyncio.events.worker.Counter",
            new=_FakeCounter,
            create=True,
        ),
    ):
        total, processed_ids, allowed = await worker.process_batch(batch)

    # Messages are still ACKed (processed_ids) so they don't block the PEL.
    assert len(processed_ids) == 3
    # But no ingest happened.
    assert total == 0
    assert allowed == []
    worker.service.ingest.assert_not_called()


@pytest.mark.asyncio
async def test_l2_per_org_delta_aggregates_across_projects():
    """Two projects in the same org → single Counter check with total delta."""
    org_id = uuid4()
    proj_a = uuid4()
    proj_b = uuid4()
    payload_a = _make_event_message(organization_id=org_id, project_id=proj_a)
    payload_b = _make_event_message(organization_id=org_id, project_id=proj_b)
    batch = _make_batch([payload_a, payload_a, payload_b])  # 2 in A, 1 in B

    worker = _make_worker(ingest_return=1)

    calls: List[Dict[str, Any]] = []

    async def _fake_check(**kwargs):
        calls.append(kwargs)
        return True, None, None

    with (
        patch("oss.src.tasks.asyncio.events.worker.is_ee", return_value=True),
        patch(
            "oss.src.tasks.asyncio.events.worker.check_entitlements",
            new=_fake_check,
            create=True,
        ),
        patch(
            "oss.src.tasks.asyncio.events.worker.scope_from",
            new=_fake_scope_from,
            create=True,
        ),
        patch(
            "oss.src.tasks.asyncio.events.worker.Counter",
            new=_FakeCounter,
            create=True,
        ),
    ):
        total, processed_ids, allowed = await worker.process_batch(batch)

    # One Counter check for the whole org (not one per project).
    assert len(calls) == 1
    assert calls[0]["delta"] == 3
    assert len(allowed) == 2  # two project batches ingested
    assert worker.service.ingest.await_count == 2


@pytest.mark.asyncio
async def test_l2_skipped_on_oss():
    """OSS (is_ee=False) → no Counter check, ingest proceeds."""
    org_id = uuid4()
    proj_id = uuid4()
    payload = _make_event_message(organization_id=org_id, project_id=proj_id)
    batch = _make_batch([payload])

    worker = _make_worker(ingest_return=1)

    with patch("oss.src.tasks.asyncio.events.worker.is_ee", return_value=False):
        total, processed_ids, allowed = await worker.process_batch(batch)

    assert total == 1
    assert len(allowed) == 1
    worker.service.ingest.assert_awaited_once()


@pytest.mark.asyncio
async def test_l2_check_failure_drops_org_batch():
    """Entitlements adapter raises → drop the org's events conservatively."""
    org_id = uuid4()
    proj_id = uuid4()
    payload = _make_event_message(organization_id=org_id, project_id=proj_id)
    batch = _make_batch([payload, payload])

    worker = _make_worker()

    async def _fake_check(**kwargs):
        raise RuntimeError("meters DB unavailable")

    with (
        patch("oss.src.tasks.asyncio.events.worker.is_ee", return_value=True),
        patch(
            "oss.src.tasks.asyncio.events.worker.check_entitlements",
            new=_fake_check,
            create=True,
        ),
        patch(
            "oss.src.tasks.asyncio.events.worker.scope_from",
            new=_fake_scope_from,
            create=True,
        ),
        patch(
            "oss.src.tasks.asyncio.events.worker.Counter",
            new=_FakeCounter,
            create=True,
        ),
    ):
        total, processed_ids, allowed = await worker.process_batch(batch)

    assert total == 0
    assert allowed == []
    worker.service.ingest.assert_not_called()
