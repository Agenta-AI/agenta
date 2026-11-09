"""The settle table and the settle pass."""

from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionState,
)
from oss.src.core.sessions.records.dtos import TurnSignals
from oss.src.core.triggers.dtos import (
    SETTLEABLE_STATUS_CODES,
    TriggerDeliveryOutcome as Outcome,
)
from oss.src.core.triggers.outcomes import (
    _START_ROWS,
    MAX_PAGES,
    PAGE_SIZE,
    STARTED_STATUS_CODE,
    OutcomesService,
    settle,
)
from oss.tests.pytest.unit.triggers._failure_fakes import (
    NOW,
    make_delivery,
    minutes_ago,
)

SETTLED_AT = minutes_ago(1)
UPDATED_AT = minutes_ago(2)
CREATED_AT = minutes_ago(3)


def _run(**kwargs):
    return make_delivery(
        "202", run_id="turn-1", session_id="session-1", created_at=CREATED_AT, **kwargs
    )


def _execution(outcome, error=None):
    return SessionExecutionSettlement(
        project_id=uuid4(),
        session_id="session-1",
        execution_id="turn-1",
        state=list(SessionExecutionState)[-1],
        terminal_outcome=outcome,
        error=error,
        settled_at=SETTLED_AT,
    )


@pytest.mark.parametrize(
    ("code", "details", "outcome", "reason_code"),
    [
        ("400", None, Outcome.FAILED, "bad_configuration"),
        (
            "403",
            {"code": "agent_deleted", "message": "gone", "retryable": False},
            Outcome.FAILED,
            "paused_agent_deleted",
        ),
        ("422", None, Outcome.SKIPPED, "agent_needs_setup"),
        ("500", None, Outcome.FAILED, "start_failed"),
    ],
)
def test_a_start_status_settles_at_the_time_of_the_status_write(
    code, details, outcome, reason_code
):
    delivery = make_delivery(
        code, created_at=CREATED_AT, updated_at=UPDATED_AT, error_details=details
    )

    settled = settle(delivery, None, None)

    assert (settled.outcome, settled.reason_code) == (outcome, reason_code)
    assert settled.ended_at == UPDATED_AT


def test_a_start_status_with_no_update_uses_its_creation_time():
    settled = settle(make_delivery("400", created_at=CREATED_AT), None, None)

    assert settled.ended_at == CREATED_AT


@pytest.mark.parametrize("code", ["102", "409", "200"])
def test_other_statuses_are_not_settled(code):
    assert settle(make_delivery(code), _execution("failed"), None) is None


@pytest.mark.parametrize(
    ("terminal_outcome", "outcome"),
    [
        ("completed", Outcome.COMPLETED),
        ("continued", Outcome.NEEDED_APPROVAL),
        ("stopped", Outcome.CANCELLED),
        ("not_running", Outcome.CANCELLED),
        ("a_value_added_later", Outcome.CANCELLED),
    ],
)
def test_a_settled_execution_that_is_not_a_failure(terminal_outcome, outcome):
    settled = settle(_run(), _execution(terminal_outcome), None)

    assert (settled.outcome, settled.reason_code) == (outcome, None)


@pytest.mark.parametrize(
    ("execution", "signals", "reason_code"),
    [
        (_execution("failed", {"code": "access_denied"}), None, "access_denied"),
        (
            _execution("failed", {"code": "access_denied"}),
            TurnSignals(error_code="other"),
            "access_denied",
        ),
        (
            _execution("failed"),
            TurnSignals(error_code="credential_delivery_failed"),
            "credential_delivery_failed",
        ),
        (_execution("failed"), None, "runner_error"),
        (_execution("failed", {"message": "no code"}), None, "runner_error"),
        (_execution("lost"), None, "execution_lost"),
        (
            _execution("lost"),
            TurnSignals(stop_reason=None, error_code="other"),
            "execution_lost",
        ),
    ],
)
def test_a_failed_execution_gets_its_reason(execution, signals, reason_code):
    settled = settle(_run(), execution, signals)

    assert settled.outcome == Outcome.FAILED
    assert settled.reason_code == reason_code
    assert settled.ended_at == SETTLED_AT


@pytest.mark.parametrize(
    ("signals", "outcome"),
    [
        (TurnSignals(stop_reason="paused"), Outcome.NEEDED_APPROVAL),
        (TurnSignals(stop_reason="cancelled"), Outcome.CANCELLED),
    ],
)
def test_a_turn_with_no_settled_execution_reads_its_done_record(signals, outcome):
    assert settle(_run(), None, signals).outcome == outcome


@pytest.mark.parametrize(
    "signals",
    [
        None,
        TurnSignals(),
        TurnSignals(stop_reason="error"),
        TurnSignals(error_code="x"),
    ],
)
def test_a_run_still_going_is_not_settled(signals):
    assert settle(_run(), None, signals) is None


def test_a_watchdog_ending_stays_lost_when_a_thawed_runner_sends_done():
    settled = settle(_run(), _execution("lost"), TurnSignals(stop_reason=None))

    assert (settled.outcome, settled.reason_code) == (Outcome.FAILED, "execution_lost")


def _service(pages, *, executions=None, signals=None, rules=None):
    triggers_dao = MagicMock()
    triggers_dao.query_unsettled_deliveries = AsyncMock(side_effect=pages)
    triggers_dao.settle_delivery = AsyncMock(return_value=True)
    executions_dao = MagicMock()
    executions_dao.query_settled = AsyncMock(return_value=executions or {})
    records_dao = MagicMock()
    records_dao.turn_signals = AsyncMock(return_value=signals or {})
    service = OutcomesService(
        triggers_dao=triggers_dao,
        session_executions_dao=executions_dao,
        records_dao=records_dao,
        failure_notifications=MagicMock(apply=rules or AsyncMock()),
    )
    return service, triggers_dao, records_dao


def _settled_ids(triggers_dao):
    return [
        call.kwargs["delivery_id"]
        for call in triggers_dao.settle_delivery.await_args_list
    ]


async def test_each_page_applies_oldest_first_and_paging_moves_forward():
    older, newer = (
        make_delivery("500", created_at=minutes_ago(9)),
        make_delivery("500", created_at=minutes_ago(1)),
    )
    full_page = [newer] * (PAGE_SIZE - 1) + [older]
    service, triggers_dao, _ = _service([full_page, []])

    await service.settle_pass()

    assert _settled_ids(triggers_dao)[0] == older.id
    calls = triggers_dao.query_unsettled_deliveries.await_args_list
    assert [call.kwargs["before"] for call in calls] == [
        None,
        (older.created_at, older.id),
    ]


async def test_a_pass_reads_at_most_four_pages():
    full_page = [make_delivery("500")] * PAGE_SIZE
    service, triggers_dao, _ = _service([full_page] * 6)

    await service.settle_pass()

    assert triggers_dao.query_unsettled_deliveries.await_count == MAX_PAGES
    assert triggers_dao.settle_delivery.await_count == PAGE_SIZE * MAX_PAGES


async def test_a_short_page_ends_the_pass():
    service, triggers_dao, _ = _service([[make_delivery("500")]])

    await service.settle_pass()

    assert triggers_dao.query_unsettled_deliveries.await_count == 1


async def test_a_row_that_raises_stays_unsettled_and_the_others_settle():
    first = make_delivery("500", created_at=minutes_ago(3))
    bad = make_delivery("500", created_at=minutes_ago(2))
    last = make_delivery("500", created_at=minutes_ago(1))

    async def apply(*, delivery, **_):
        if delivery.id == bad.id:
            raise RuntimeError("secret address a@example.com")

    service, triggers_dao, _ = _service(
        [[last, bad, first]], rules=AsyncMock(side_effect=apply)
    )

    await service.settle_pass()

    assert _settled_ids(triggers_dao) == [first.id, last.id]


async def test_the_guarded_write_gets_the_status_that_was_read():
    delivery = make_delivery(
        "403",
        error_details={"code": "access_denied", "message": "x", "retryable": False},
    )
    service, triggers_dao, _ = _service([[delivery]])

    await service.settle_pass()

    assert triggers_dao.settle_delivery.await_args.kwargs == {
        "project_id": delivery.project_id,
        "delivery_id": delivery.id,
        "status_code": "403",
        "outcome": Outcome.FAILED,
        "reason_code": "paused_access_denied",
    }


def test_the_settleable_codes_are_the_codes_settle_handles():
    assert set(_START_ROWS) | {STARTED_STATUS_CODE} == set(SETTLEABLE_STATUS_CODES)


async def test_records_are_read_for_every_turn():
    project_id = uuid4()
    deliveries = [
        make_delivery(
            "202",
            project_id=project_id,
            run_id=f"turn-{name}",
            session_id="session-1",
            created_at=NOW - timedelta(minutes=index),
        )
        for index, name in enumerate(["done", "coded", "codeless", "running"])
    ]
    executions = {
        ("session-1", "turn-done"): _execution("completed"),
        ("session-1", "turn-coded"): _execution("failed", {"code": "access_denied"}),
        ("session-1", "turn-codeless"): _execution("failed"),
    }
    service, _, records_dao = _service([deliveries], executions=executions)

    await service.settle_pass()

    assert records_dao.turn_signals.await_args.kwargs["keys"] == [
        ("session-1", "turn-done"),
        ("session-1", "turn-coded"),
        ("session-1", "turn-codeless"),
        ("session-1", "turn-running"),
    ]


async def test_a_coded_error_with_a_codeless_fallback_reaches_the_row():
    delivery = make_delivery("202", run_id="turn-1", session_id="session-1")
    service, triggers_dao, _ = _service(
        [[delivery]],
        executions={("session-1", "turn-1"): _execution("failed")},
        signals={
            ("session-1", "turn-1"): TurnSignals(
                stop_reason="error", error_code="credential_delivery_failed"
            )
        },
    )

    await service.settle_pass()

    kwargs = triggers_dao.settle_delivery.await_args.kwargs
    assert kwargs["reason_code"] == "credential_delivery_failed"


def test_delivery_values_drop_nul_from_event_data():
    from oss.src.dbs.postgres.triggers.upsert_utils import (
        build_trigger_delivery_values,
    )

    values = build_trigger_delivery_values(
        {"data": {"event": {"text": "a\x00b", "nested": ["c\x00"]}}}
    )

    assert values["data"] == {"event": {"text": "ab", "nested": ["c"]}}


def test_a_failed_run_keeps_the_message_of_its_error_record():
    settled = settle(
        _run(),
        _execution("failed"),
        TurnSignals(error_code="runner_error", error_message="The model is missing."),
    )

    assert settled.error_message == "The model is missing."
