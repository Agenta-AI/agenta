"""Triggers store their executing principal and direct target agent (M2)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.triggers.models import TriggerScheduleCreateRequest
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.triggers.dtos import (
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerScheduleEdit,
)
from oss.src.core.triggers.service import TriggersService
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher


_DEFAULT_TARGET = object()


def _service(*, revision_artifact_id=None):
    dao = MagicMock()
    dao.create_schedule = AsyncMock(side_effect=lambda **kw: kw)
    dao.fetch_schedule = AsyncMock(return_value=SimpleNamespace(id=uuid4()))
    dao.edit_schedule = AsyncMock(side_effect=lambda **kw: kw)
    workflows = MagicMock()
    workflows.retrieve_workflow_revision = AsyncMock(
        return_value=(
            SimpleNamespace(workflow_id=revision_artifact_id, artifact_id=None),
            None,
            None,
        )
    )
    service = TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=MagicMock(),
        workflows_service=workflows,
    )
    return service, dao


def _schedule_data(references):
    return TriggerScheduleData(
        event_key="cron.tick", schedule="0 * * * *", references=references
    )


async def test_create_by_human_stores_principal_and_artifact():
    artifact_id = uuid4()
    service, dao = _service(revision_artifact_id=artifact_id)
    principal = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
    await service.create_schedule(
        project_id=uuid4(),
        user_id=principal.id,
        schedule=TriggerScheduleCreate(
            data=_schedule_data({"workflow": {"id": str(artifact_id)}})
        ),
        principal=principal,
    )
    kwargs = dao.create_schedule.await_args.kwargs
    assert kwargs["principal"] == principal
    assert kwargs["artifact_id"] == artifact_id


async def test_environment_reference_leaves_artifact_null():
    service, dao = _service(revision_artifact_id=uuid4())
    await service.create_schedule(
        project_id=uuid4(),
        user_id=uuid4(),
        schedule=TriggerScheduleCreate(
            data=_schedule_data(
                {"environment": {"slug": "production"}, "workflow": {"slug": "agent"}}
            )
        ),
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4()),
    )
    assert dao.create_schedule.await_args.kwargs["artifact_id"] is None


async def test_edit_keeps_principal_recomputes_artifact():
    new_artifact = uuid4()
    service, dao = _service(revision_artifact_id=new_artifact)
    await service.edit_schedule(
        project_id=uuid4(),
        user_id=uuid4(),
        schedule=TriggerScheduleEdit(
            id=uuid4(), data=_schedule_data({"workflow": {"id": str(new_artifact)}})
        ),
    )
    kwargs = dao.edit_schedule.await_args.kwargs
    assert kwargs["artifact_id"] == new_artifact
    assert "principal" not in kwargs


def test_create_body_cannot_set_principal():
    body = TriggerScheduleCreateRequest.model_validate(
        {
            "schedule": {
                "data": {"event_key": "cron.tick", "schedule": "* * * * *"},
                "principal": {"kind": "human", "id": str(uuid4())},
                "artifact_id": str(uuid4()),
            }
        }
    )
    dumped = body.schedule.model_dump()
    assert "principal" not in dumped and "artifact_id" not in dumped


async def test_scheduled_run_as_api_key(_allowing_access_service):
    key = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())
    schedule = TriggerSchedule(
        id=uuid4(),
        created_by_id=uuid4(),
        principal=key,
        data=_schedule_data({"workflow": {"slug": "agent"}}),
    )
    dao = MagicMock()
    dao.dedup_seen_schedule = AsyncMock(return_value=False)
    dao.update_delivery = AsyncMock()
    claims = MagicMock()
    claims.claim_trigger_delivery = AsyncMock(return_value=True)
    dispatch = AsyncMock(return_value="run-1")
    dispatcher = TriggersDispatcher(
        triggers_dao=dao,
        session_claims_dao=claims,
        workflows_service=MagicMock(),
        dispatch_fn=dispatch,
    )
    project_id = uuid4()
    await dispatcher.dispatch_schedule(
        project_id=project_id, schedule=schedule, event_id="tick-1", event={}
    )
    envelope = dispatch.await_args.kwargs["envelope"]
    assert envelope.authority.principal == key
    assert envelope.authority.project_id == project_id
    assert envelope.context.origin.value == "schedule"
    assert envelope.context.origin_id == str(schedule.id)
    assert envelope.authority.linked_user_id is None


async def test_null_principal_is_refused_and_paused_without_reconstruction(
    _allowing_access_service,
):
    schedule = TriggerSchedule(
        id=uuid4(),
        created_by_id=uuid4(),
        data=_schedule_data({"workflow": {"slug": "agent"}}),
    )
    dao = MagicMock()
    dao.dedup_seen_schedule = AsyncMock(return_value=False)
    dao.refuse_delivery = AsyncMock()
    claims = MagicMock()
    claims.claim_trigger_delivery = AsyncMock(return_value=True)
    dispatch = AsyncMock()
    dispatcher = TriggersDispatcher(
        triggers_dao=dao,
        session_claims_dao=claims,
        workflows_service=MagicMock(),
        dispatch_fn=dispatch,
    )
    await dispatcher.dispatch_schedule(
        project_id=uuid4(), schedule=schedule, event_id="tick-1", event={}
    )
    kwargs = dao.refuse_delivery.await_args.kwargs
    assert kwargs["reason"] == "missing_principal"
    data = kwargs["delivery"].data
    assert data.error_details.code == "missing_principal"
    assert data.error == data.error_details.message
    claims.claim_trigger_delivery.assert_not_awaited()
    dispatch.assert_not_awaited()
    assert _allowing_access_service.decisions == []


@pytest.fixture
def _allowing_access_service(_allowing_access_service):
    return _allowing_access_service


# -- C12: recheck before each run -----------------------------------------------------


def _dispatch_setup(*, access_service, references=None, target=_DEFAULT_TARGET):
    from oss.src.core.workflows.dtos import ResolvedTarget

    order = []
    schedule = TriggerSchedule(
        id=uuid4(),
        created_by_id=uuid4(),
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4()),
        data=_schedule_data(references or {"workflow": {"slug": "agent"}}),
    )
    dao = MagicMock()
    dao.dedup_seen_schedule = AsyncMock(return_value=False)
    dao.update_delivery = AsyncMock()
    dao.refuse_delivery = AsyncMock(side_effect=lambda **kw: order.append("refuse"))
    claims = MagicMock()

    async def _claim(**kwargs):
        order.append("claim")
        return True

    claims.claim_trigger_delivery = AsyncMock(side_effect=_claim)
    workflows = MagicMock()
    resolved = (
        ResolvedTarget(artifact_id=uuid4(), revision_id=uuid4())
        if target is _DEFAULT_TARGET
        else target
    )

    async def _resolve(**kwargs):
        order.append("resolve")
        return resolved

    workflows.resolve_request_target = AsyncMock(side_effect=_resolve)

    async def _dispatch(**kwargs):
        order.append("dispatch")
        return "run-1"

    dispatch = AsyncMock(side_effect=_dispatch)

    original_decide = access_service.decide

    async def _decide(**kwargs):
        order.append("decide")
        return await original_decide(**kwargs)

    access_service.decide = _decide
    dispatcher = TriggersDispatcher(
        triggers_dao=dao,
        session_claims_dao=claims,
        workflows_service=workflows,
        dispatch_fn=dispatch,
        access_service=access_service,
    )
    return SimpleNamespace(
        dispatcher=dispatcher,
        schedule=schedule,
        dao=dao,
        claims=claims,
        workflows=workflows,
        dispatch=dispatch,
        order=order,
        target=resolved,
    )


async def _tick(setup):
    await setup.dispatcher.dispatch_schedule(
        project_id=uuid4(), schedule=setup.schedule, event_id="tick-1", event={}
    )


async def test_creator_removed_pauses_and_explains():
    from oss.src.core.access.dtos import DecisionReason
    from oss.tests.pytest.utils.principals import DenyingAccessService

    setup = _dispatch_setup(
        access_service=DenyingAccessService(reason=DecisionReason.NOT_MEMBER)
    )
    await _tick(setup)

    kwargs = setup.dao.refuse_delivery.await_args.kwargs
    assert kwargs["reason"] == "access_denied"
    details = kwargs["delivery"].data.error_details
    assert details.code == "access_denied"
    assert details.details["reason"] == "not_member"
    setup.claims.claim_trigger_delivery.assert_not_awaited()
    setup.dispatch.assert_not_awaited()


async def test_subscription_key_deleted_pauses_no_run():
    from oss.src.core.access.dtos import DecisionReason
    from oss.tests.pytest.utils.principals import DenyingAccessService

    setup = _dispatch_setup(
        access_service=DenyingAccessService(reason=DecisionReason.PRINCIPAL_INACTIVE)
    )
    setup.schedule = setup.schedule.model_copy(
        update={"principal": PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())}
    )
    await _tick(setup)

    details = setup.dao.refuse_delivery.await_args.kwargs["delivery"].data
    assert details.error_details.details["reason"] == "principal_inactive"
    assert details.error_details.details["principal_kind"] == "api_key"
    setup.dispatch.assert_not_awaited()


async def test_deny_happens_before_claim():
    from oss.tests.pytest.utils.principals import (
        AllowingAccessService,
        DenyingAccessService,
    )

    allowed = _dispatch_setup(access_service=AllowingAccessService())
    await _tick(allowed)
    assert allowed.order == ["resolve", "decide", "claim", "dispatch"]

    denied = _dispatch_setup(access_service=DenyingAccessService())
    await _tick(denied)
    assert denied.order == ["resolve", "decide", "refuse"]


async def test_decide_checks_run_workflows_on_the_resolved_agent():
    from oss.src.core.access.dtos import ResourceKind
    from oss.src.core.access.permissions.types import Permission
    from oss.tests.pytest.utils.principals import AllowingAccessService

    service = AllowingAccessService()
    setup = _dispatch_setup(access_service=service)
    await _tick(setup)

    asked = service.decisions[-1]
    assert asked["action"] == Permission.RUN_WORKFLOWS
    assert asked["resource"].kind == ResourceKind.AGENT
    assert asked["resource"].id == str(setup.target.artifact_id)
    assert asked["principal"] == setup.schedule.principal


async def test_environment_target_resolved_before_check():
    from oss.tests.pytest.utils.principals import AllowingAccessService

    setup = _dispatch_setup(
        access_service=AllowingAccessService(),
        references={
            "environment": {"slug": "production"},
            "workflow": {"slug": "agent"},
        },
    )
    await _tick(setup)

    request = setup.workflows.resolve_request_target.await_args.kwargs["request"]
    assert "environment" in request.references
    assert setup.order.index("resolve") < setup.order.index("decide")
    # The dispatched request is the one that was resolved and checked.
    assert setup.dispatch.await_args.kwargs["request"] is request


async def test_archived_target_pauses():
    from oss.src.core.workflows.dtos import ResolvedTarget
    from oss.tests.pytest.utils.principals import AllowingAccessService

    service = AllowingAccessService()
    setup = _dispatch_setup(
        access_service=service,
        target=ResolvedTarget(artifact_id=uuid4(), revision_id=uuid4(), archived=True),
    )
    await _tick(setup)

    kwargs = setup.dao.refuse_delivery.await_args.kwargs
    assert kwargs["reason"] == "agent_deleted"
    assert kwargs["delivery"].data.error_details.code == "agent_deleted"
    assert service.decisions == []
    setup.claims.claim_trigger_delivery.assert_not_awaited()


async def test_unresolved_target_keeps_the_failed_delivery():
    from oss.tests.pytest.utils.principals import AllowingAccessService

    setup = _dispatch_setup(access_service=AllowingAccessService(), target=None)
    await _tick(setup)

    setup.dao.refuse_delivery.assert_not_awaited()
    setup.claims.claim_trigger_delivery.assert_awaited_once()
    status = setup.dao.update_delivery.await_args.kwargs["status"]
    assert status.code == "400"
    setup.dispatch.assert_not_awaited()


async def test_dispatch_resolves_target_once():
    from oss.tests.pytest.utils.principals import AllowingAccessService

    setup = _dispatch_setup(access_service=AllowingAccessService())
    await _tick(setup)
    setup.workflows.resolve_request_target.assert_awaited_once()
