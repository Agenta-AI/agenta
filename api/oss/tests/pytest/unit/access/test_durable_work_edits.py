"""Only the executing principal changes what durable work executes (M7 edit rule).

Spec: openspec/changes/personal-credentials-bindings/specs/durable-work-edits.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.shared.durable_work import durable_work_refused
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.access.durable_work import (
    DurableWorkChange,
    DurableWorkKind,
    DurableWorkOwnerOnly,
    check_durable_work_change,
    execution_changed,
)
from oss.src.core.evaluations.service import (
    EvaluationsService,
    SimpleEvaluationsService,
)
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunEdit,
    EvaluationStatus,
    SimpleEvaluationData,
    SimpleEvaluationEdit,
    SimpleEvaluationFlags,
)
from oss.src.core.triggers.dtos import (
    TriggerSchedule,
    TriggerScheduleData,
    TriggerScheduleEdit,
    TriggerScheduleFlags,
    TriggerSubscription,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
)
from oss.src.core.triggers.service import TriggersService

ALICE = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
BOB = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
KEY = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())
OTHER_KEY = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())

AGENT_A = {"workflow": {"id": str(uuid4())}}
AGENT_B = {"workflow": {"id": str(uuid4())}}


# --- the rule ----------------------------------------------------------------------


def test_lifecycle_change_is_allowed_for_anyone():
    check_durable_work_change(
        kind=DurableWorkKind.SCHEDULE,
        principal=BOB,
        executing=ALICE,
        change=DurableWorkChange.LIFECYCLE,
    )


@pytest.mark.parametrize(
    "principal,executing,allowed",
    [
        (ALICE, ALICE, True),
        (BOB, ALICE, False),
        (KEY, KEY, True),
        (OTHER_KEY, KEY, False),
        # A human cannot change work that runs as an API key, even its creator.
        (ALICE, KEY, False),
        # A row with no stored principal: nobody changes what it executes.
        (ALICE, None, False),
    ],
)
def test_execution_change_needs_the_executing_principal(principal, executing, allowed):
    call = lambda: check_durable_work_change(  # noqa: E731
        kind=DurableWorkKind.SCHEDULE,
        principal=principal,
        executing=executing,
        change=DurableWorkChange.EXECUTION,
    )
    if allowed:
        call()
    else:
        with pytest.raises(DurableWorkOwnerOnly) as refused:
            call()
        assert refused.value.executing == executing


def test_execution_changed_ignores_container_shape_only():
    assert not execution_changed({"a": [1, 2]}, {"a": (1, 2)})
    assert execution_changed({"a": [1, 2]}, {"a": [2, 1]})
    # An explicit null input and a type change are real changes of what runs.
    assert execution_changed({"a": 1}, {"a": 1, "b": None})
    assert execution_changed({"a": True}, {"a": 1})


async def test_the_rule_is_checked_on_the_locked_row():
    """Bob's rename passes against the row he read; if Alice changed what it runs in
    between, his full write would restore her old target. The DAO runs the check on the
    row it locked, so the write is refused."""
    existing = _schedule()
    service, dao = _triggers(schedule=existing)
    moved_by_alice = _schedule_edit(existing, references=AGENT_B)
    locked = existing.model_copy(update={"data": moved_by_alice.data})

    async def edit_with_lock(**kwargs):
        kwargs["check"](locked)
        return kwargs["schedule"]

    dao.edit_schedule = AsyncMock(side_effect=edit_with_lock)
    with pytest.raises(DurableWorkOwnerOnly):
        await service.edit_schedule(
            project_id=uuid4(),
            user_id=BOB.id,
            schedule=_schedule_edit(existing, schedule="30 6 * * *"),
            editor=BOB,
        )


# --- schedules and subscriptions ----------------------------------------------------


def _triggers(*, schedule=None, subscription=None):
    dao = MagicMock()
    dao.fetch_schedule = AsyncMock(return_value=schedule)
    dao.fetch_subscription = AsyncMock(return_value=subscription)

    # The DAO runs the rule on the row it locks: here, the row it was given.
    async def edit_schedule(**kw):
        if kw.get("check"):
            kw["check"](schedule)
        return kw["schedule"]

    async def edit_subscription(**kw):
        if kw.get("check"):
            kw["check"](subscription)
        return kw["subscription"]

    dao.edit_schedule = AsyncMock(side_effect=edit_schedule)
    dao.edit_subscription = AsyncMock(side_effect=edit_subscription)
    service = TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=MagicMock(),
        workflows_service=MagicMock(),
    )
    service._validate_references = AsyncMock(return_value=None)
    service._sync_provider_enabled = AsyncMock()
    return service, dao


def _schedule(principal=ALICE, references=AGENT_A, inputs=None):
    return TriggerSchedule(
        id=uuid4(),
        principal=principal,
        data=TriggerScheduleData(
            event_key="cron.tick",
            schedule="0 * * * *",
            references=references,
            inputs_fields=inputs,
        ),
    )


def _schedule_edit(existing, **data):
    fields = existing.data.model_dump()
    fields.update(data)
    return TriggerScheduleEdit(
        id=existing.id,
        name="renamed",
        data=TriggerScheduleData(**fields),
        flags=TriggerScheduleFlags(is_active=False),
    )


async def test_bob_cannot_change_the_target_of_alices_schedule():
    existing = _schedule()
    service, dao = _triggers(schedule=existing)

    with pytest.raises(DurableWorkOwnerOnly) as refused:
        await service.edit_schedule(
            project_id=uuid4(),
            user_id=BOB.id,
            schedule=_schedule_edit(existing, references=AGENT_B),
            editor=BOB,
        )

    assert refused.value.executing == ALICE


async def test_bob_cannot_change_the_input_of_alices_schedule():
    existing = _schedule(inputs={"to": "team@example.com"})
    service, dao = _triggers(schedule=existing)

    with pytest.raises(DurableWorkOwnerOnly):
        await service.edit_schedule(
            project_id=uuid4(),
            user_id=BOB.id,
            schedule=_schedule_edit(existing, inputs_fields={"to": "bob@example.com"}),
            editor=BOB,
        )


async def test_alice_changes_her_own_schedule_and_keeps_her_principal():
    existing = _schedule()
    service, dao = _triggers(schedule=existing)

    await service.edit_schedule(
        project_id=uuid4(),
        user_id=ALICE.id,
        schedule=_schedule_edit(existing, references=AGENT_B, inputs_fields={"x": 1}),
        editor=ALICE,
    )

    kwargs = dao.edit_schedule.await_args.kwargs
    assert "principal" not in kwargs


async def test_bob_may_rename_pause_and_retime_alices_schedule():
    existing = _schedule()
    service, dao = _triggers(schedule=existing)

    await service.edit_schedule(
        project_id=uuid4(),
        user_id=BOB.id,
        schedule=_schedule_edit(existing, schedule="30 6 * * *"),
        editor=BOB,
    )

    dao.edit_schedule.assert_awaited_once()
    assert "principal" not in dao.edit_schedule.await_args.kwargs


async def test_api_key_schedule_changes_only_with_the_same_key():
    existing = _schedule(principal=KEY)
    service, dao = _triggers(schedule=existing)

    with pytest.raises(DurableWorkOwnerOnly):
        await service.edit_schedule(
            project_id=uuid4(),
            user_id=uuid4(),
            schedule=_schedule_edit(existing, references=AGENT_B),
            editor=OTHER_KEY,
        )
    dao.edit_schedule.reset_mock()
    await service.edit_schedule(
        project_id=uuid4(),
        user_id=uuid4(),
        schedule=_schedule_edit(existing, references=AGENT_B),
        editor=KEY,
    )
    dao.edit_schedule.assert_awaited_once()


def _subscription(principal=ALICE):
    return TriggerSubscription(
        id=uuid4(),
        principal=principal,
        connection_id=uuid4(),
        data=TriggerSubscriptionData(event_key="gmail.new", references=AGENT_A),
    )


def _subscription_edit(existing, *, connection_id=None, **data):
    fields = existing.data.model_dump()
    fields.update(data)
    return TriggerSubscriptionEdit(
        id=existing.id,
        name="renamed",
        connection_id=connection_id or existing.connection_id,
        data=TriggerSubscriptionData(**fields),
    )


async def test_bob_cannot_move_alices_subscription_to_another_connection():
    existing = _subscription()
    service, dao = _triggers(subscription=existing)

    with pytest.raises(DurableWorkOwnerOnly):
        await service.edit_subscription(
            project_id=uuid4(),
            user_id=BOB.id,
            subscription=_subscription_edit(existing, connection_id=uuid4()),
            editor=BOB,
        )
    with pytest.raises(DurableWorkOwnerOnly):
        await service.edit_subscription(
            project_id=uuid4(),
            user_id=BOB.id,
            subscription=_subscription_edit(existing, references=AGENT_B),
            editor=BOB,
        )
    dao.edit_subscription.assert_not_awaited()


async def test_bob_may_rename_alices_subscription():
    existing = _subscription()
    service, dao = _triggers(subscription=existing)

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=BOB.id,
        subscription=_subscription_edit(existing),
        editor=BOB,
    )
    dao.edit_subscription.assert_awaited_once()


# --- evaluation runs -----------------------------------------------------------------


def _run(principal=ALICE, testset_id=None):
    return EvaluationRun(
        id=uuid4(),
        principal=principal,
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="testset",
                    type="input",
                    origin="auto",
                    references={"testset": {"id": str(testset_id or uuid4())}},
                )
            ],
            mappings=[],
        ),
    )


def _evaluations(run):
    dao = MagicMock()
    dao.fetch_run = AsyncMock(return_value=run)
    dao.fetch_runs = AsyncMock(return_value=[run])

    async def edit_run(**kw):
        if kw.get("check"):
            kw["check"](run)
        return None

    dao.edit_run = AsyncMock(side_effect=edit_run)
    dao.edit_runs = AsyncMock(return_value=[])
    service = EvaluationsService.__new__(EvaluationsService)
    service.evaluations_dao = dao
    return service, dao


async def test_bob_cannot_change_the_testset_of_alices_evaluation_run():
    run = _run()
    service, dao = _evaluations(run)
    edit = EvaluationRunEdit(id=run.id, data=_run().data)

    with pytest.raises(DurableWorkOwnerOnly) as refused:
        await service.edit_run(project_id=uuid4(), user_id=BOB.id, run=edit, editor=BOB)
    assert refused.value.kind == DurableWorkKind.EVALUATION_RUN

    with pytest.raises(DurableWorkOwnerOnly):
        await service.edit_runs(
            project_id=uuid4(), user_id=BOB.id, runs=[edit], editor=BOB
        )
    dao.edit_runs.assert_not_awaited()


async def test_bob_may_rename_and_stop_alices_evaluation_run():
    run = _run()
    service, dao = _evaluations(run)
    edit = EvaluationRunEdit(
        id=run.id, name="renamed", status=EvaluationStatus.CANCELLED, data=run.data
    )

    await service.edit_run(project_id=uuid4(), user_id=BOB.id, run=edit, editor=BOB)
    dao.edit_run.assert_awaited_once()
    assert "principal" not in dao.edit_run.await_args.kwargs


async def test_alice_changes_her_own_evaluation_run():
    run = _run()
    service, dao = _evaluations(run)
    edit = EvaluationRunEdit(id=run.id, data=_run().data)

    await service.edit_run(project_id=uuid4(), user_id=ALICE.id, run=edit, editor=ALICE)
    dao.edit_run.assert_awaited_once()


async def test_internal_edits_are_not_checked():
    run = _run()
    service, dao = _evaluations(run)

    await service.edit_run(
        project_id=uuid4(),
        user_id=uuid4(),
        run=EvaluationRunEdit(id=run.id, data=_run().data),
    )
    dao.edit_run.assert_awaited_once()


async def test_bob_cannot_change_the_testset_of_alices_simple_evaluation():
    run = _run()
    testset_a, testset_b = uuid4(), uuid4()
    evaluations = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run), edit_run=AsyncMock()
    )
    service = SimpleEvaluationsService.__new__(SimpleEvaluationsService)
    service.evaluations_service = evaluations
    service.fetch = AsyncMock(
        return_value=SimpleNamespace(
            id=run.id,
            flags=SimpleEvaluationFlags(is_active=True),
            data=SimpleEvaluationData(testset_steps=[testset_a]),
        )
    )
    service.stop = AsyncMock()

    edit = SimpleEvaluationEdit(
        id=run.id,
        flags=SimpleEvaluationFlags(),
        data=SimpleEvaluationData(testset_steps=[testset_b]),
    )
    with pytest.raises(DurableWorkOwnerOnly):
        await service.edit(
            project_id=uuid4(), user_id=BOB.id, evaluation=edit, editor=BOB
        )
    # Refused before anything changes: the run is not even stopped.
    service.stop.assert_not_awaited()
    evaluations.edit_run.assert_not_awaited()


# --- the refusal names the person -----------------------------------------------------


async def test_refusal_names_the_person_the_work_runs_as():
    user = SimpleNamespace(username="alice", email="alice@example.com")
    with patch(
        "oss.src.apis.fastapi.shared.durable_work.db_manager.get_user_with_id",
        AsyncMock(return_value=user),
    ):
        error = await durable_work_refused(
            DurableWorkOwnerOnly(kind=DurableWorkKind.SCHEDULE, executing=ALICE)
        )
    assert error.status_code == 403
    assert error.detail["code"] == "owner_only"
    assert "alice" in error.detail["message"]
    assert error.detail["details"]["principal_id"] == str(ALICE.id)


async def test_refusal_for_api_key_work():
    error = await durable_work_refused(
        DurableWorkOwnerOnly(kind=DurableWorkKind.SUBSCRIPTION, executing=KEY)
    )
    assert "an API key" in error.detail["message"]


async def test_the_evaluation_rule_is_checked_on_the_locked_row():
    run = _run()
    service, dao = _evaluations(run)
    moved_by_alice = _run().data
    locked = run.model_copy(update={"data": moved_by_alice})

    async def edit_with_lock(**kwargs):
        kwargs["check"](locked)
        return None

    dao.edit_run = AsyncMock(side_effect=edit_with_lock)
    with pytest.raises(DurableWorkOwnerOnly):
        await service.edit_run(
            project_id=uuid4(),
            user_id=BOB.id,
            run=EvaluationRunEdit(id=run.id, name="renamed", data=run.data),
            editor=BOB,
        )


def _simple_service(run, *, stored, edit_run):
    evaluations = SimpleNamespace(
        fetch_run=AsyncMock(return_value=stored),
        edit_run=AsyncMock(side_effect=edit_run),
    )
    service = SimpleEvaluationsService.__new__(SimpleEvaluationsService)
    service.evaluations_service = evaluations
    return service, evaluations


async def test_a_simple_evaluation_rename_keeps_the_stored_configuration():
    """Bob renames Alice's simple evaluation with its targets unchanged. The write
    carries the configuration as stored (not a rebuild), and `edit_run` checks it
    against the locked row with Bob as the editor."""
    run = _run()
    testset = uuid4()
    captured = {}

    async def edit_run(**kwargs):
        captured.update(kwargs)

    service, evaluations = _simple_service(run, stored=run, edit_run=edit_run)
    service.fetch = AsyncMock(
        return_value=SimpleNamespace(
            id=run.id,
            flags=SimpleEvaluationFlags(is_active=False),
            data=SimpleEvaluationData(testset_steps=[testset]),
        )
    )
    service._make_evaluation_run_flags = AsyncMock(return_value=None)
    service._make_evaluation_run_data = AsyncMock(
        side_effect=AssertionError("a rename must not rebuild the configuration")
    )
    with patch("oss.src.core.evaluations.service.sleep", AsyncMock()):
        await service.edit(
            project_id=uuid4(),
            user_id=BOB.id,
            evaluation=SimpleEvaluationEdit(
                id=run.id,
                name="renamed",
                flags=SimpleEvaluationFlags(),
                data=SimpleEvaluationData(testset_steps=[testset]),
            ),
            editor=BOB,
        )
    assert captured["editor"] == BOB
    assert captured["run"].data == run.data


async def test_a_stored_configuration_changed_before_the_lock_refuses_the_rename():
    """Alice changed the run after Bob's read: the locked-row check sees a different
    configuration from the one Bob's rename writes, and refuses it."""
    run = _run()
    service, dao = _evaluations(run.model_copy(update={"data": _run().data}))
    with pytest.raises(DurableWorkOwnerOnly):
        await service.edit_run(
            project_id=uuid4(),
            user_id=BOB.id,
            run=EvaluationRunEdit(id=run.id, name="renamed", data=run.data),
            editor=BOB,
        )
