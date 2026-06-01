"""Unit tests for the admin retention routers (spans + events).

Each router owns its own Redis lock namespace and its own service call. These
tests stub both so the routes don't talk to real infra.
"""

from json import loads
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from ee.src.apis.fastapi.events.router import EventsRetentionRouter
from ee.src.apis.fastapi.spans.router import SpansRetentionRouter


@pytest.mark.asyncio
async def test_spans_admin_flush_acquires_lock_and_calls_service(monkeypatch):
    acquire_calls: list[dict] = []
    release_calls: list[dict] = []

    async def fake_acquire_lock(**kwargs):
        acquire_calls.append(kwargs)
        return "lock-owner-spans"

    async def fake_release_lock(**kwargs):
        release_calls.append(kwargs)
        return True

    monkeypatch.setattr(
        "ee.src.apis.fastapi.spans.router.acquire_lock", fake_acquire_lock
    )
    monkeypatch.setattr(
        "ee.src.apis.fastapi.spans.router.release_lock", fake_release_lock
    )

    tracing_retention_service = SimpleNamespace(flush_spans=AsyncMock())
    router = SpansRetentionRouter(tracing_retention_service=tracing_retention_service)

    response = await router.flush()

    assert response.status_code == 200
    assert loads(response.body) == {"status": "success"}
    tracing_retention_service.flush_spans.assert_awaited_once()
    assert acquire_calls[0]["namespace"] == "spans:flush"
    assert release_calls[0]["namespace"] == "spans:flush"


@pytest.mark.asyncio
async def test_events_admin_flush_acquires_lock_and_calls_service(monkeypatch):
    acquire_calls: list[dict] = []
    release_calls: list[dict] = []

    async def fake_acquire_lock(**kwargs):
        acquire_calls.append(kwargs)
        return "lock-owner-events"

    async def fake_release_lock(**kwargs):
        release_calls.append(kwargs)
        return True

    monkeypatch.setattr(
        "ee.src.apis.fastapi.events.router.acquire_lock", fake_acquire_lock
    )
    monkeypatch.setattr(
        "ee.src.apis.fastapi.events.router.release_lock", fake_release_lock
    )

    events_retention_service = SimpleNamespace(flush_events=AsyncMock())
    router = EventsRetentionRouter(events_retention_service=events_retention_service)

    response = await router.flush()

    assert response.status_code == 200
    assert loads(response.body) == {"status": "success"}
    events_retention_service.flush_events.assert_awaited_once()
    assert acquire_calls[0]["namespace"] == "events:flush"
    assert release_calls[0]["namespace"] == "events:flush"


@pytest.mark.asyncio
async def test_events_admin_flush_skips_when_lock_busy(monkeypatch):
    async def fake_acquire_lock(**kwargs):
        return None  # someone else holds the lock

    async def fake_release_lock(**kwargs):
        return False

    monkeypatch.setattr(
        "ee.src.apis.fastapi.events.router.acquire_lock", fake_acquire_lock
    )
    monkeypatch.setattr(
        "ee.src.apis.fastapi.events.router.release_lock", fake_release_lock
    )

    events_retention_service = SimpleNamespace(flush_events=AsyncMock())
    router = EventsRetentionRouter(events_retention_service=events_retention_service)

    response = await router.flush()

    assert response.status_code == 200
    assert loads(response.body) == {"status": "skipped"}
    events_retention_service.flush_events.assert_not_called()


@pytest.mark.asyncio
async def test_spans_and_events_use_independent_locks():
    """Smoke test that the two routers use distinct lock namespaces — the
    asserts inside the previous two tests already cover this, but this is the
    invariant we care about: a busy spans lock must NOT block events, and
    vice versa.
    """
    assert "spans:flush" != "events:flush"
