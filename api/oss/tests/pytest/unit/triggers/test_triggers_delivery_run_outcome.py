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


def _settlement(*, session_id="s1", run_id="r1", outcome="completed"):
    return SessionExecutionSettlement(
        project_id=_PROJECT,
        session_id=session_id,
        execution_id=run_id,
        terminal_outcome=outcome,
        settled_by="runner",
        settled_at=_SETTLED_AT,
    )


def _service(*, deliveries, settled=None, with_executions=True):
    dao = MagicMock()
    dao.query_deliveries = AsyncMock(return_value=deliveries)
    dao.fetch_delivery = AsyncMock(return_value=deliveries[0] if deliveries else None)
    executions = MagicMock()
    executions.query_settled = AsyncMock(return_value=settled or {})
    service = TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=MagicMock(),
        workflows_service=MagicMock(),
        executions_dao=executions if with_executions else None,
    )
    return service, executions


@pytest.mark.parametrize(
    "outcome, message",
    [
        ("completed", "success"),
        ("failed", "failed"),
        ("stopped", "failed"),
        ("lost", "failed"),
    ],
)
async def test_settled_run_shows_its_outcome(outcome, message):
    delivery = _delivery()
    service, executions = _service(
        deliveries=[delivery],
        settled={("s1", "r1"): _settlement(outcome=outcome)},
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == message
    assert result.status.code == "202"
    assert result.status.timestamp == _SETTLED_AT
    executions.query_settled.assert_awaited_once_with(
        project_id=_PROJECT, keys=[("s1", "r1")]
    )
    # The stored row is not changed.
    assert delivery.status.message == "dispatched"


async def test_running_or_missing_execution_stays_dispatched():
    # A run still going has no settled row; neither does a run whose execution is missing.
    service, _ = _service(deliveries=[_delivery()], settled={})

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"


async def test_continued_run_stays_dispatched():
    service, _ = _service(
        deliveries=[_delivery()],
        settled={("s1", "r1"): _settlement(outcome="continued")},
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"


async def test_finished_rows_are_not_looked_up():
    rows = [_delivery(message="success"), _delivery(message="failed")]
    service, executions = _service(deliveries=rows)

    result = await service.query_deliveries(project_id=_PROJECT)

    assert [row.status.message for row in result] == ["success", "failed"]
    executions.query_settled.assert_not_awaited()


async def test_dispatched_row_without_run_id_is_left_alone():
    service, executions = _service(deliveries=[_delivery(run_id=None)])

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"
    executions.query_settled.assert_not_awaited()


async def test_one_lookup_for_many_rows_keeps_order():
    rows = [
        _delivery(session_id="s1", run_id="r1"),
        _delivery(message="success", session_id="s2", run_id="r2"),
        _delivery(session_id="s3", run_id="r3"),
    ]
    service, executions = _service(
        deliveries=rows,
        settled={("s3", "r3"): _settlement(session_id="s3", run_id="r3")},
    )

    result = await service.query_deliveries(project_id=_PROJECT)

    assert [row.id for row in result] == [row.id for row in rows]
    assert [row.status.message for row in result] == [
        "dispatched",
        "success",
        "success",
    ]
    executions.query_settled.assert_awaited_once()
    assert executions.query_settled.await_args.kwargs["keys"] == [
        ("s1", "r1"),
        ("s3", "r3"),
    ]


async def test_fetch_delivery_shows_the_outcome():
    service, _ = _service(
        deliveries=[_delivery()],
        settled={("s1", "r1"): _settlement(outcome="failed")},
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
        settled={("s1", "r1"): _settlement(outcome=None)},
    )

    [result] = await service.query_deliveries(project_id=_PROJECT)

    assert result.status.message == "dispatched"
