"""Unit tests for the events retention service.

Validates plan iteration logic (which plans get flushed) and the project-paging
loop. The DAO is mocked because the SQL against the events table is exercised
in integration; here we just verify the service drives the DAO correctly based
on each plan's ``Counter.EVENTS_INGESTED.retention``.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from ee.src.core.entitlements.types import (
    Counter,
    Period,
    Quota,
    Retention,
    Tracker,
)
from ee.src.core.events.service import EventsRetentionService


def _plan_with_retention(retention: Retention | None) -> dict:
    return {
        Tracker.COUNTERS: {
            Counter.EVENTS_INGESTED: Quota(period=Period.MONTHLY, retention=retention),
        }
    }


def _plan_without_events() -> dict:
    return {Tracker.COUNTERS: {Counter.TRACES_INGESTED: Quota(period=Period.MONTHLY)}}


@pytest.mark.asyncio
async def test_flush_skips_plans_without_events_retention(monkeypatch):
    plans = {
        "plan_a": _plan_with_retention(None),  # unlimited retention
        "plan_b": _plan_without_events(),  # no events counter at all
    }
    monkeypatch.setattr("ee.src.core.events.service.get_plans", lambda: plans)

    dao = SimpleNamespace(
        fetch_projects_with_plan=AsyncMock(return_value=[]),
        delete_events_before_cutoff=AsyncMock(return_value=0),
    )
    service = EventsRetentionService(events_retention_dao=dao)

    await service.flush_events()

    # No plan had a retention period, so the DAO never paged projects.
    dao.fetch_projects_with_plan.assert_not_called()
    dao.delete_events_before_cutoff.assert_not_called()


@pytest.mark.asyncio
async def test_flush_pages_projects_then_deletes(monkeypatch):
    plans = {"plan_a": _plan_with_retention(Retention.HOURLY)}  # 1 hour retention
    monkeypatch.setattr("ee.src.core.events.service.get_plans", lambda: plans)

    project_a = uuid4()
    project_b = uuid4()
    fetch_calls = [[project_a, project_b], []]
    dao = SimpleNamespace(
        fetch_projects_with_plan=AsyncMock(side_effect=fetch_calls),
        delete_events_before_cutoff=AsyncMock(return_value=42),
    )
    service = EventsRetentionService(events_retention_dao=dao)

    await service.flush_events()

    assert dao.fetch_projects_with_plan.await_count == 2
    # First call: cursor None; second call: cursor = last project_id of page 1.
    first_call_kwargs = dao.fetch_projects_with_plan.await_args_list[0].kwargs
    second_call_kwargs = dao.fetch_projects_with_plan.await_args_list[1].kwargs
    assert first_call_kwargs["project_id"] is None
    assert second_call_kwargs["project_id"] == project_b

    dao.delete_events_before_cutoff.assert_awaited_once()
    delete_kwargs = dao.delete_events_before_cutoff.await_args.kwargs
    assert delete_kwargs["project_ids"] == [project_a, project_b]
    # Cutoff must be in the past.
    assert delete_kwargs["cutoff"] < datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_flush_continues_on_per_plan_failure(monkeypatch):
    plans = {
        "plan_a": _plan_with_retention(Retention.HOURLY),
        "plan_b": _plan_with_retention(Retention.HOURLY),
    }
    monkeypatch.setattr("ee.src.core.events.service.get_plans", lambda: plans)

    project = uuid4()

    async def fetch_side_effect(*, plan, project_id, max_projects):
        if plan == "plan_a" and project_id is None:
            raise RuntimeError("simulated DAO failure")
        if plan == "plan_b" and project_id is None:
            return [project]
        return []

    dao = SimpleNamespace(
        fetch_projects_with_plan=AsyncMock(side_effect=fetch_side_effect),
        delete_events_before_cutoff=AsyncMock(return_value=7),
    )
    service = EventsRetentionService(events_retention_dao=dao)

    # plan_a raises; plan_b must still run.
    await service.flush_events()

    dao.delete_events_before_cutoff.assert_awaited_once()
    assert dao.delete_events_before_cutoff.await_args.kwargs["project_ids"] == [project]


@pytest.mark.asyncio
async def test_flush_empty_entitlements_skipped(monkeypatch):
    # Display-only plan (e.g. custom plan with description only) has no
    # entitlements map. The service must skip it without raising.
    plans = {"display_only": {}}
    monkeypatch.setattr("ee.src.core.events.service.get_plans", lambda: plans)

    dao = SimpleNamespace(
        fetch_projects_with_plan=AsyncMock(),
        delete_events_before_cutoff=AsyncMock(),
    )
    service = EventsRetentionService(events_retention_dao=dao)

    await service.flush_events()

    dao.fetch_projects_with_plan.assert_not_called()
