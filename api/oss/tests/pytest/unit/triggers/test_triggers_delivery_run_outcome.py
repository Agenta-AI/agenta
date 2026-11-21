"""Unit tests for the run outcome on a detached delivery.

The dispatcher writes `202 dispatched` when the runner accepts a detached run, and nothing
writes the row again. ``TriggersService`` reads the end of the run from
``session_executions`` and shows it on the delivery it returns. Stubs both DAOs; no DB.
"""

from datetime import datetime, timezone
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

import pytest

from oss.src.core.sessions.executions.dtos import SessionExecutionSettlement
from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import TriggerDelivery, TriggerDeliveryData
from oss.src.core.triggers.service import TriggersService

_PROJECT = uuid4()
_SETTLED_AT = datetime(2026, 11, 20, 21, 16, 5, tzinfo=timezone.utc)


def _delivery(*, message="dispatched", session_id="s1", run_id="r1"):
    return TriggerDelivery(
        id=uuid4(),
        status=Status(code="202", message=message),
        data=TriggerDeliveryData(
            session_id=session_id,
            result={"run_id": run_id} if run_id else None,
        ),
        schedule_id=uuid4(),
        event_id=f"event-{uuid4()}",
    )


def _settlement(
    *, session_id="s1", run_id="r1", outcome="completed", parent=None, answered=False
):
    # `answered`: the child a person's answer started (it names its interaction).
    return SessionExecutionSettlement(
        project_id=_PROJECT,
        session_id=session_id,
        execution_id=run_id,
        parent_execution_id=parent,
        source_interaction_id=uuid4() if answered else None,
        terminal_outcome=outcome,
        settled_by="runner" if outcome else None,
        settled_at=_SETTLED_AT if outcome else None,
    )


def _service(*, deliveries, executions=None, with_executions=True):
    dao = MagicMock()
    dao.query_deliveries = AsyncMock(return_value=deliveries)
    dao.fetch_delivery = AsyncMock(return_value=deliveries[0] if deliveries else None)
    executions_dao = MagicMock()
    executions_dao.query_session_executions = AsyncMock(return_value=executions or [])
    service = TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=MagicMock(),
        workflows_service=MagicMock(),
        executions_dao=executions_dao if with_executions else None,
    )
    return service, executions_dao


@pytest.mark.parametrize(
    "outcome, message",
    [
        ("completed", "success"),
        ("failed", "failed"),
        ("stopped", "failed"),
        # A Stop that lands as the run ends settles the execution as not_running.
        ("not_running", "failed"),
        ("lost", "failed"),
    ],
)
async def test_settled_run_shows_its_outcome(outcome, message):
    delivery = _delivery()
    service, executions = _service(
        deliveries=[delivery],
        executions=[_settlement(outcome=outcome)],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == message
    assert result.status.code == "202"
    assert result.status.timestamp == _SETTLED_AT
    executions.query_session_executions.assert_awaited_once_with(
        project_id=_PROJECT, session_ids=["s1"]
    )
    # The stored row is not changed.
    assert delivery.status.message == "dispatched"


async def test_running_or_missing_execution_stays_dispatched():
    # A run still going has no settled row; neither does a run whose execution is missing.
    service, _ = _service(deliveries=[_delivery()], executions=[])

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"


async def test_continued_run_stays_dispatched():
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[_settlement(outcome="continued")],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"


async def test_finished_rows_are_not_looked_up():
    rows = [_delivery(message="success"), _delivery(message="failed")]
    service, executions = _service(deliveries=rows)

    result = await service.query_deliveries(project_id=_PROJECT)

    assert [row.status.message for row in result] == ["success", "failed"]
    executions.query_session_executions.assert_not_awaited()


async def test_dispatched_row_without_run_id_is_left_alone():
    service, executions = _service(deliveries=[_delivery(run_id=None)])

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"
    executions.query_session_executions.assert_not_awaited()


async def test_one_lookup_for_many_rows_keeps_order():
    rows = [
        _delivery(session_id="s1", run_id="r1"),
        _delivery(message="success", session_id="s2", run_id="r2"),
        _delivery(session_id="s3", run_id="r3"),
    ]
    service, executions = _service(
        deliveries=rows,
        executions=[_settlement(session_id="s3", run_id="r3")],
    )

    result = await service.query_deliveries(project_id=_PROJECT)

    assert [row.id for row in result] == [row.id for row in rows]
    assert [row.status.message for row in result] == [
        "dispatched",
        "success",
        "success",
    ]
    executions.query_session_executions.assert_awaited_once()
    assert executions.query_session_executions.await_args.kwargs["session_ids"] == [
        "s1",
        "s3",
    ]


async def test_fetch_delivery_shows_the_outcome():
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[_settlement(outcome="failed")],
    )

    result = await service.fetch_delivery(project_id=_PROJECT, delivery_id=uuid4())

    assert result is not None
    assert result.status.message == "failed"


async def test_without_executions_dao_rows_pass_through():
    service, _ = _service(deliveries=[_delivery()], with_executions=False)

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"


async def test_execution_with_no_outcome_stays_dispatched():
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[_settlement(outcome=None)],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"


async def test_running_child_execution_keeps_the_run_dispatched():
    # The run waited for a person; the answer started a child execution that still runs.
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[
            _settlement(outcome="continued"),
            _settlement(run_id="r2", outcome=None, parent="r1", answered=True),
        ],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"


@pytest.mark.parametrize(
    "outcome, message", [("completed", "success"), ("failed", "failed")]
)
async def test_settled_child_execution_ends_the_run(outcome, message):
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[
            _settlement(outcome="continued"),
            _settlement(run_id="r2", outcome="continued", parent="r1", answered=True),
            _settlement(run_id="r3", outcome=outcome, parent="r2", answered=True),
        ],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == message


async def test_execution_of_another_run_in_the_session_is_not_used():
    service, _ = _service(
        deliveries=[_delivery(run_id="r1")],
        executions=[_settlement(run_id="other", outcome="completed")],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"


async def test_continued_with_no_child_yet_stays_dispatched():
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[_settlement(outcome="continued")],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"


@pytest.mark.parametrize(
    "replacement, message",
    [(None, "dispatched"), ("completed", "success"), ("failed", "failed")],
)
async def test_lost_attempt_is_carried_on_by_its_replacement(replacement, message):
    # A continuation attempt (c1) was lost; its replacement (c2) hangs from it.
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[
            _settlement(outcome="continued"),
            _settlement(run_id="c1", outcome="lost", parent="r1", answered=True),
            _settlement(run_id="c2", outcome=replacement, parent="c1"),
        ],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == message


async def test_second_replacement_wins_over_a_lost_one():
    # c2 was lost too; c3 replaced it, also under the first attempt c1.
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[
            _settlement(outcome="continued"),
            _settlement(run_id="c1", outcome="lost", parent="r1", answered=True),
            _settlement(run_id="c2", outcome="lost", parent="c1"),
            _settlement(run_id="c3", outcome="completed", parent="c1"),
        ],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "success"


async def test_lost_attempt_with_no_replacement_reads_failed():
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[
            _settlement(outcome="continued"),
            _settlement(run_id="c1", outcome="lost", parent="r1", answered=True),
        ],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "failed"


async def test_queued_message_after_a_lost_first_run_does_not_hide_the_failure():
    # The watchdog settled the run as lost and promoted a queued message under it.
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[
            _settlement(outcome="lost"),
            _settlement(run_id="q1", outcome="completed", parent="r1"),
        ],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "failed"


async def test_queued_message_is_not_the_continuation_of_an_answered_run():
    service, _ = _service(
        deliveries=[_delivery()],
        executions=[
            _settlement(outcome="continued"),
            _settlement(run_id="q1", outcome="completed", parent="r1"),
        ],
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"
