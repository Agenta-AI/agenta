"""Unit tests for backfill and forwardfill (`core/channels/fill.py`).

Fakes the DAO and the adapter port directly (no DB, no HTTP, no broker) per
the house testing rule: fill logic needs nothing running.
"""

from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelFill,
    ChannelFillMode,
    ChannelInboundEvent,
    ChannelInboxEvent,
    ChannelInboxEventProcessed,
    ChannelInboxTrigger,
    ChannelInboxTriggerFlags,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceFlags,
    ChannelSpaceKind,
    ChannelTriggerState,
)
from oss.src.core.channels.fill import run_backfill, select_forwardfill_range

pytestmark = pytest.mark.asyncio


def _capabilities(*, backfill_supported: bool = True) -> ChannelCapabilities:
    return ChannelCapabilities(
        channel="slack",
        fill=ChannelFill(
            backfill=ChannelFillMode(supported=backfill_supported),
            forwardfill=ChannelFillMode(supported=True),
        ),
    )


def _space(*, is_backfilled: bool = False) -> ChannelSpace:
    return ChannelSpace(
        id=uuid4(),
        connection_id=uuid4(),
        kind=ChannelSpaceKind.GROUP,
        external_key=uuid4(),
        data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C1"}),
        flags=ChannelSpaceFlags(is_backfilled=is_backfilled),
    )


def _inbound_event(*, external_id: str = "msg-1") -> ChannelInboundEvent:
    return ChannelInboundEvent(
        external_id=external_id,
        kind=ChannelEventKind.MESSAGE,
        space_kind=ChannelSpaceKind.GROUP,
        space_locator={"team": "T1", "channel": "C1"},
        external_locator={"team": "T1", "channel": "C1", "ts": external_id},
        processed=ChannelInboxEventProcessed(
            content=[{"type": "text", "text": "hello"}],
            sender={"id": "U1"},
        ),
    )


def _dao(
    *,
    mark_space_backfilled_result: Optional[ChannelSpace] = None,
    record_inbox_events_result: Optional[List[ChannelInboxEvent]] = None,
    fetch_latest_trigger_result: Optional[ChannelInboxTrigger] = None,
    query_events_since_result: Optional[List[ChannelInboxEvent]] = None,
):
    dao = MagicMock()
    dao.record_inbox_events = AsyncMock(return_value=record_inbox_events_result or [])
    dao.mark_space_backfilled = AsyncMock(return_value=mark_space_backfilled_result)
    dao.fetch_latest_trigger = AsyncMock(return_value=fetch_latest_trigger_result)
    dao.query_events_since = AsyncMock(return_value=query_events_since_result or [])
    return dao


def _adapter(*, fetch_history_result=None, fetch_history_side_effect=None):
    adapter = MagicMock()
    if fetch_history_side_effect is not None:
        adapter.fetch_history = AsyncMock(side_effect=fetch_history_side_effect)
    else:
        adapter.fetch_history = AsyncMock(return_value=fetch_history_result or [])
    return adapter


class TestBackfillGuard:
    async def test_already_backfilled_space_never_fetches(self):
        space = _space(is_backfilled=True)
        dao = _dao()
        adapter = _adapter()

        result = await run_backfill(
            project_id=uuid4(),
            channels_dao=dao,
            adapter=adapter,
            connection=MagicMock(id=uuid4()),
            space=space,
            capabilities=_capabilities(),
        )

        assert result is None
        adapter.fetch_history.assert_not_called()
        dao.mark_space_backfilled.assert_not_called()

    async def test_capability_not_supported_never_fetches_or_writes_status(self):
        space = _space(is_backfilled=False)
        dao = _dao()
        adapter = _adapter()

        result = await run_backfill(
            project_id=uuid4(),
            channels_dao=dao,
            adapter=adapter,
            connection=MagicMock(id=uuid4()),
            space=space,
            capabilities=_capabilities(backfill_supported=False),
        )

        assert result is None
        adapter.fetch_history.assert_not_called()
        dao.mark_space_backfilled.assert_not_called()
        dao.record_inbox_events.assert_not_called()


class TestBackfillFetch:
    async def test_successful_fetch_appends_pulled_events_and_sets_flag(self):
        space = _space(is_backfilled=False)
        dao = _dao(mark_space_backfilled_result=_space(is_backfilled=True))
        adapter = _adapter(fetch_history_result=[_inbound_event()])
        connection = MagicMock(id=uuid4())

        result = await run_backfill(
            project_id=uuid4(),
            channels_dao=dao,
            adapter=adapter,
            connection=connection,
            space=space,
            capabilities=_capabilities(),
        )

        assert result is None
        dao.record_inbox_events.assert_awaited_once()
        _, kwargs = dao.record_inbox_events.call_args
        assert len(kwargs["events"]) == 1
        assert kwargs["events"][0].origin == ChannelEventOrigin.PULLED
        assert kwargs["events"][0].connection_id == connection.id
        dao.mark_space_backfilled.assert_awaited_once()

    async def test_empty_fetch_still_sets_the_flag(self):
        """Fetched-and-empty must be distinguishable from never-fetched: the
        flag is what carries that distinction, not a row count."""

        space = _space(is_backfilled=False)
        dao = _dao()
        adapter = _adapter(fetch_history_result=[])

        result = await run_backfill(
            project_id=uuid4(),
            channels_dao=dao,
            adapter=adapter,
            connection=MagicMock(id=uuid4()),
            space=space,
            capabilities=_capabilities(),
        )

        assert result is None
        dao.record_inbox_events.assert_not_called()
        dao.mark_space_backfilled.assert_awaited_once()

    async def test_refused_fetch_leaves_flag_unset_and_returns_status(self):
        space = _space(is_backfilled=False)
        dao = _dao()
        adapter = _adapter(
            fetch_history_side_effect=Exception("channels:history denied")
        )

        result = await run_backfill(
            project_id=uuid4(),
            channels_dao=dao,
            adapter=adapter,
            connection=MagicMock(id=uuid4()),
            space=space,
            capabilities=_capabilities(),
        )

        assert result is not None
        assert result.code == "403"
        dao.mark_space_backfilled.assert_not_called()
        dao.record_inbox_events.assert_not_called()

    async def test_second_agent_in_same_space_causes_no_second_fetch(self):
        """The guard is per space: once flags.is_backfilled is true (as the
        DAO would report after the first fetch), a second caller for a
        different agent in the same space must not fetch again."""

        adapter = _adapter(fetch_history_result=[_inbound_event()])
        dao = _dao(mark_space_backfilled_result=_space(is_backfilled=True))

        first_space = _space(is_backfilled=False)
        await run_backfill(
            project_id=uuid4(),
            channels_dao=dao,
            adapter=adapter,
            connection=MagicMock(id=uuid4()),
            space=first_space,
            capabilities=_capabilities(),
        )

        # second addressing reads the space fresh; is_backfilled is now true
        second_space = _space(is_backfilled=True)
        await run_backfill(
            project_id=uuid4(),
            channels_dao=dao,
            adapter=adapter,
            connection=MagicMock(id=uuid4()),
            space=second_space,
            capabilities=_capabilities(),
        )

        adapter.fetch_history.assert_called_once()

    async def test_limit_is_passed_through_to_the_adapter(self):
        space = _space(is_backfilled=False)
        dao = _dao()
        adapter = _adapter(fetch_history_result=[])

        await run_backfill(
            project_id=uuid4(),
            channels_dao=dao,
            adapter=adapter,
            connection=MagicMock(id=uuid4()),
            space=space,
            capabilities=_capabilities(),
            limit=50,
        )

        _, kwargs = adapter.fetch_history.call_args
        assert kwargs["limit"] == 50

    async def test_fetch_returning_fewer_than_the_limit_is_not_an_error(self):
        space = _space(is_backfilled=False)
        dao = _dao()
        adapter = _adapter(fetch_history_result=[_inbound_event()])

        result = await run_backfill(
            project_id=uuid4(),
            channels_dao=dao,
            adapter=adapter,
            connection=MagicMock(id=uuid4()),
            space=space,
            capabilities=_capabilities(),
            limit=50,
        )

        assert result is None
        dao.mark_space_backfilled.assert_awaited_once()


class TestForwardfillRange:
    async def test_no_trigger_yet_reads_the_whole_log(self):
        dao = _dao(
            fetch_latest_trigger_result=None,
            query_events_since_result=[MagicMock()],
        )

        events = await select_forwardfill_range(
            project_id=uuid4(),
            channels_dao=dao,
            thread_id=uuid4(),
            space_id=uuid4(),
        )

        assert len(events) == 1
        _, kwargs = dao.query_events_since.call_args
        assert kwargs["after_event_id"] is None

    async def test_offset_comes_from_the_latest_trigger_event_id(self):
        offset_event_id = uuid4()
        trigger = ChannelInboxTrigger(
            id=uuid4(),
            thread_id=uuid4(),
            event_id=offset_event_id,
            turn_id="t-1",
            state=ChannelTriggerState.SETTLED,
            flags=ChannelInboxTriggerFlags(),
        )
        dao = _dao(fetch_latest_trigger_result=trigger, query_events_since_result=[])

        await select_forwardfill_range(
            project_id=uuid4(),
            channels_dao=dao,
            thread_id=trigger.thread_id,
            space_id=uuid4(),
        )

        _, kwargs = dao.query_events_since.call_args
        assert kwargs["after_event_id"] == offset_event_id

    async def test_range_read_claims_nothing_two_threads_can_read_concurrently(self):
        """Nothing in this package claims or marks a row — the range read is
        idempotent and safe for two threads to run against the same space."""

        dao = _dao(
            fetch_latest_trigger_result=None,
            query_events_since_result=[MagicMock(), MagicMock()],
        )

        first = await select_forwardfill_range(
            project_id=uuid4(),
            channels_dao=dao,
            thread_id=uuid4(),
            space_id=uuid4(),
        )
        second = await select_forwardfill_range(
            project_id=uuid4(),
            channels_dao=dao,
            thread_id=uuid4(),
            space_id=uuid4(),
        )

        assert len(first) == 2
        assert len(second) == 2
        assert dao.query_events_since.await_count == 2
