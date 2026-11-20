"""Unit tests for schedules that send an input into an existing session.

Pins the shape rule (`data.session_id` with `data.session_input`, never with a
workflow reference), the internal create function (hidden, the stored envelope with
origin `schedule`, the principal from the envelope, tenant scope), the hard delete by
id, the fire into the session (busy, idle, deleted target, lost access, a retryable
failure, the delete after the fire), the hidden filter in every DAO read that a public
route uses, and the refusal of the server-only fields on the public create and edit
routes. Stubs the DAO, the session queue and the engine; no DB.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from oss.tests.pytest.utils.principals import any_approval, any_principal
from oss.tests.pytest.utils.sharing import NoopRunAdmission

from oss.src.apis.fastapi.triggers.models import (
    TriggerScheduleCreateRequest,
    TriggerScheduleEditRequest,
)
from oss.src.apis.fastapi.triggers.router import TriggersRouter
from oss.src.core.access.dtos import (
    Decision,
    DecisionReason,
    RunAuthority,
    RunContext,
    RunEnvelope,
    RunOrigin,
    RunSender,
)
from oss.src.core.sessions.inputs.dtos import PendingInputKind, PendingInputState
from oss.src.core.sessions.starts.dtos import SessionInputEnqueueResult
from oss.src.core.sessions.starts.types import SessionStartNotDurable
from oss.src.core.sharing.admission import TRIGGER_DISPATCH_BOUNDARY
from oss.src.core.sharing.types import AdmissionDenied
from oss.src.core.triggers.dtos import (
    TriggerDeliveryQuery,
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerScheduleEdit,
    TriggerScheduleFlags,
    TriggerScheduleSessionInput,
)
from oss.src.core.triggers.service import TriggersService
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.src.dbs.postgres.triggers.mappings import (
    map_schedule_dbe_to_dto,
    map_schedule_dto_to_dbe_create,
)
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher


_RUN_AT = datetime(2026, 6, 22, 10, 30, tzinfo=timezone.utc)
_SESSION_ID = "c0ffee00c0ffee00c0ffee00c0ffee00"


def _content(*, session_id=_SESSION_ID, references=None):
    return {
        "session_id": session_id,
        "references": (
            references if references is not None else {"workflow": {"id": str(uuid4())}}
        ),
        "data": {"inputs": {"messages": [{"role": "user", "content": "Update"}]}},
    }


def _session_input(**kwargs):
    return TriggerScheduleSessionInput(
        kind=PendingInputKind.child_update, content=_content(**kwargs)
    )


def _envelope(*, project_id, approved=False):
    principal = any_principal()
    return RunEnvelope(
        authority=RunAuthority(
            principal=principal,
            organization_id=uuid4(),
            project_id=project_id,
        ),
        context=RunContext(
            run_id="run-1",
            parent_run_id="parent-1",
            origin=RunOrigin.WEB,
        ),
        sender=RunSender(user_id=principal.id),
        approved_by=any_approval() if approved else None,
    )


def _session_schedule(*, project_id, envelope="default", is_hidden=True):
    schedule_id = uuid4()
    if envelope == "default":
        envelope = _envelope(project_id=project_id)
    return TriggerSchedule(
        id=schedule_id,
        created_by_id=uuid4(),
        principal=envelope.authority.principal if envelope else any_principal(),
        flags=TriggerScheduleFlags(is_active=True, is_hidden=is_hidden),
        data=TriggerScheduleData(
            event_key="still_running",
            run_at=_RUN_AT,
            session_id=_SESSION_ID,
            session_input=_session_input(),
        ),
        run_envelope=envelope,
    )


# -- the shape ------------------------------------------------------------------------


class TestShape:
    def test_a_session_target_needs_its_input(self):
        with pytest.raises(ValidationError):
            TriggerScheduleData(
                event_key="still_running", run_at=_RUN_AT, session_id=_SESSION_ID
            )
        with pytest.raises(ValidationError):
            TriggerScheduleData(
                event_key="still_running",
                run_at=_RUN_AT,
                session_input=_session_input(),
            )

    def test_a_session_target_has_no_workflow_reference(self):
        with pytest.raises(ValidationError):
            TriggerScheduleData(
                event_key="still_running",
                run_at=_RUN_AT,
                session_id=_SESSION_ID,
                session_input=_session_input(),
                references={"workflow": {"id": str(uuid4())}},
            )

    def test_the_envelope_is_never_serialized(self):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id)
        assert "run_envelope" not in schedule.model_dump(mode="json")

    def test_the_mapping_stores_the_target_and_reads_the_envelope(self):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id)
        dbe = map_schedule_dto_to_dbe_create(
            project_id=project_id,
            user_id=uuid4(),
            schedule=TriggerScheduleCreate(data=schedule.data, flags=schedule.flags),
        )
        assert dbe.data["session_id"] == _SESSION_ID
        assert dbe.data["session_input"]["kind"] == "child_update"
        assert dbe.flags == {"is_active": True, "is_hidden": True}
        assert dbe.run_envelope is None  # only the internal create writes it

        dbe.id = uuid4()
        read = map_schedule_dbe_to_dto(schedule_dbe=dbe)
        assert read.data.session_input == schedule.data.session_input
        assert read.run_envelope is None


# -- the internal create and the delete ----------------------------------------------


def _service(dao):
    return TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=MagicMock(),
        workflows_service=MagicMock(),
    )


class TestCreateSessionSchedule:
    async def test_creates_a_hidden_schedule_with_the_turn_authority(self):
        project_id = uuid4()
        user_id = uuid4()
        schedule_id = uuid4()
        envelope = _envelope(project_id=project_id, approved=True)
        dao = MagicMock(create_hidden_schedule=AsyncMock(return_value=MagicMock()))

        await _service(dao).create_session_schedule(
            project_id=project_id,
            user_id=user_id,
            schedule_id=schedule_id,
            event_key="still_running",
            run_at=datetime(2026, 6, 22, 10, 30, 1, tzinfo=timezone.utc),
            session_id=_SESSION_ID,
            session_input=_session_input(),
            run_envelope=envelope,
        )

        kwargs = dao.create_hidden_schedule.await_args.kwargs
        assert kwargs["project_id"] == project_id
        assert kwargs["user_id"] == user_id
        assert kwargs["schedule_id"] == schedule_id
        assert kwargs["principal"] == envelope.authority.principal
        stored = kwargs["run_envelope"]
        assert stored.authority == envelope.authority
        assert stored.sender == envelope.sender
        assert stored.approved_by is None
        assert stored.context == RunContext(
            origin=RunOrigin.SCHEDULE, origin_id=str(schedule_id)
        )
        created = kwargs["schedule"]
        assert created.flags == TriggerScheduleFlags(is_active=True, is_hidden=True)
        assert created.data.session_id == _SESSION_ID
        # Rounded up to the whole minute.
        assert created.data.run_at == datetime(2026, 6, 22, 10, 31, tzinfo=timezone.utc)

    @pytest.mark.parametrize(
        "case",
        ["other_project", "other_session", "no_agent", "on_busy", "visible_id"],
    )
    async def test_refuses(self, case):
        project_id = uuid4()
        envelope = _envelope(
            project_id=uuid4() if case == "other_project" else project_id
        )
        session_input = _session_input()
        if case == "other_session":
            session_input = _session_input(session_id="another")
        if case == "no_agent":
            session_input = _session_input(references={})
        if case == "on_busy":
            session_input.content["on_busy"] = "queue"
        dao = MagicMock(
            create_hidden_schedule=AsyncMock(
                return_value=None if case == "visible_id" else MagicMock()
            )
        )

        with pytest.raises(ValueError):
            await _service(dao).create_session_schedule(
                project_id=project_id,
                user_id=uuid4(),
                schedule_id=uuid4(),
                event_key="still_running",
                run_at=_RUN_AT,
                session_id=_SESSION_ID,
                session_input=session_input,
                run_envelope=envelope,
            )
        if case != "visible_id":
            dao.create_hidden_schedule.assert_not_awaited()


class TestDeleteSessionSchedule:
    async def test_deletes_and_logs_then_a_repeat_does_nothing(self, monkeypatch):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id)
        dao = MagicMock(purge_hidden_schedule=AsyncMock(side_effect=[schedule, None]))
        logged = MagicMock()
        monkeypatch.setattr("oss.src.core.triggers.utils.log.info", logged)
        service = _service(dao)

        assert await service.delete_session_schedule(
            project_id=project_id, schedule_id=schedule.id
        )
        assert not await service.delete_session_schedule(
            project_id=project_id, schedule_id=schedule.id
        )

        logged.assert_called_once()
        assert logged.call_args.kwargs["schedule_id"] == str(schedule.id)
        assert logged.call_args.kwargs["session_id"] == _SESSION_ID
        assert logged.call_args.kwargs["principal_id"] == str(schedule.principal.id)


# -- the fire into the session -------------------------------------------------------


def _dispatcher(*, stream="exists", enqueue=None, claimed=True):
    dao = MagicMock()
    dao.dedup_seen_schedule = AsyncMock(return_value=False)
    dao.claim_schedule_delivery = AsyncMock(return_value=claimed)
    dao.claim_trigger_delivery = AsyncMock()
    dao.update_delivery = AsyncMock()
    dao.purge_hidden_schedule = AsyncMock(return_value=None)
    streams = MagicMock()
    streams.get_by_session_id_including_archived = AsyncMock(
        return_value=None if stream is None else SimpleNamespace()
    )
    starts = MagicMock()
    starts.enqueue_session_input = enqueue or AsyncMock(
        return_value=SessionInputEnqueueResult(
            input_id=uuid4(),
            state=PendingInputState.promoted,
            execution_id="execution-1",
        )
    )
    dispatcher = TriggersDispatcher(
        run_admission=NoopRunAdmission(),
        triggers_dao=dao,
        session_claims_dao=dao,
        workflows_service=MagicMock(),
        session_streams_dao=streams,
        session_starts_service=starts,
    )
    return dispatcher, dao, starts


async def _fire(dispatcher, schedule, project_id, event_id="event-1"):
    await dispatcher.dispatch_schedule(
        project_id=project_id,
        schedule=schedule,
        event_id=event_id,
        event={},
    )


def _delivery_status(dao):
    return dao.update_delivery.await_args.kwargs["status"].code


class TestFireIntoSession:
    async def test_idle_target_starts_a_turn_with_the_stored_authority(self):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id)
        dispatcher, dao, starts = _dispatcher()

        await _fire(dispatcher, schedule, project_id, event_id="S:2026-06-22T10:30")

        kwargs = starts.enqueue_session_input.await_args.kwargs
        assert kwargs["project_id"] == project_id
        assert kwargs["session_id"] == _SESSION_ID
        assert kwargs["kind"] == PendingInputKind.child_update
        assert kwargs["content"] == schedule.data.session_input.content
        assert kwargs["idempotency_key"] == "ag:schedule:S:2026-06-22T10:30"
        assert kwargs["run_envelope"] is schedule.run_envelope
        assert kwargs["dispatch_boundary"] == TRIGGER_DISPATCH_BOUNDARY
        # No session is minted or claimed.
        dao.claim_trigger_delivery.assert_not_awaited()
        claim = dao.claim_schedule_delivery.await_args.kwargs
        assert claim["data"].session_id == _SESSION_ID
        assert _delivery_status(dao) == "202"
        dao.purge_hidden_schedule.assert_awaited_once_with(
            project_id=project_id, schedule_id=schedule.id
        )

    async def test_busy_target_queues_the_input(self):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id)
        pending = SessionInputEnqueueResult(
            input_id=uuid4(), state=PendingInputState.pending
        )
        dispatcher, dao, _ = _dispatcher(enqueue=AsyncMock(return_value=pending))

        await _fire(dispatcher, schedule, project_id)

        assert _delivery_status(dao) == "202"
        result = dao.update_delivery.await_args.kwargs["data"].result
        assert result["state"] == "pending"
        dao.purge_hidden_schedule.assert_awaited_once()

    async def test_deleted_target_fails_and_creates_no_session(self):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id)
        dispatcher, dao, starts = _dispatcher(stream=None)

        await _fire(dispatcher, schedule, project_id)

        starts.enqueue_session_input.assert_not_awaited()
        dao.claim_trigger_delivery.assert_not_awaited()
        assert _delivery_status(dao) == "404"
        dao.purge_hidden_schedule.assert_awaited_once()

    async def test_lost_access_refuses_the_fire(self):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id)
        denied = AdmissionDenied(
            decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED),
            readable=False,
            boundary=TRIGGER_DISPATCH_BOUNDARY,
        )
        dispatcher, dao, _ = _dispatcher(enqueue=AsyncMock(side_effect=denied))

        await _fire(dispatcher, schedule, project_id)

        assert _delivery_status(dao) == "403"
        dao.purge_hidden_schedule.assert_awaited_once()

    async def test_a_retryable_failure_keeps_the_schedule(self):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id)
        dispatcher, dao, _ = _dispatcher(
            enqueue=AsyncMock(side_effect=SessionStartNotDurable())
        )

        with pytest.raises(SessionStartNotDurable):
            await _fire(dispatcher, schedule, project_id)

        assert _delivery_status(dao) == "500"
        dao.purge_hidden_schedule.assert_not_awaited()

    async def test_a_lost_claim_does_nothing(self):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id)
        dispatcher, dao, starts = _dispatcher(claimed=False)

        await _fire(dispatcher, schedule, project_id)

        starts.enqueue_session_input.assert_not_awaited()
        dao.update_delivery.assert_not_awaited()
        dao.purge_hidden_schedule.assert_not_awaited()

    async def test_without_a_stored_envelope_the_principal_runs_it(self):
        project_id = uuid4()
        schedule = _session_schedule(project_id=project_id, envelope=None)
        dispatcher, dao, starts = _dispatcher()
        dispatcher._organization_id = AsyncMock(return_value=uuid4())

        await _fire(dispatcher, schedule, project_id)

        envelope = starts.enqueue_session_input.await_args.kwargs["run_envelope"]
        assert envelope.authority.principal == schedule.principal
        assert envelope.context == RunContext(
            origin=RunOrigin.SCHEDULE, origin_id=str(schedule.id)
        )


# -- the hidden filter in the DAO reads ------------------------------------------------


class _Capture:
    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: []),
            scalar_one_or_none=lambda: None,
        )

    async def commit(self):
        return None


def _engine(capture):
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def session():
        yield capture

    return SimpleNamespace(session=session)


def _sql(statement):
    return str(statement.compile(dialect=postgresql.dialect()))


_HIDDEN_SCHEDULE = "trigger_schedules.flags -> %(flags_1)s"


class TestDaoHiddenFilter:
    @pytest.mark.parametrize(
        "read",
        [
            lambda dao, p: dao.query_schedules(project_id=p),
            lambda dao, p: dao.fetch_schedule(project_id=p, schedule_id=uuid4()),
            lambda dao, p: dao.fetch_schedule_including_deleted(
                project_id=p, schedule_id=uuid4()
            ),
            lambda dao, p: dao.delete_schedule(
                project_id=p, user_id=uuid4(), schedule_id=uuid4()
            ),
            lambda dao, p: dao.edit_schedule(
                project_id=p,
                user_id=uuid4(),
                schedule=TriggerScheduleEdit(
                    id=uuid4(),
                    data=TriggerScheduleData(
                        event_key="cron.tick", schedule="* * * * *"
                    ),
                ),
            ),
        ],
        ids=["query", "fetch", "fetch_including_deleted", "delete", "edit"],
    )
    async def test_public_schedule_reads_leave_out_hidden_schedules(self, read):
        capture = _Capture()
        await read(TriggersDAO(engine=_engine(capture)), uuid4())
        sql = _sql(capture.statements[0])
        assert (
            "coalesce(CAST((trigger_schedules.flags ->> %(flags_1)s) AS BOOLEAN)" in sql
        )
        assert "IS false" in sql

    @pytest.mark.parametrize(
        "read",
        [
            lambda dao, p: dao.query_deliveries(project_id=p),
            lambda dao, p: dao.query_deliveries(
                project_id=p, delivery=TriggerDeliveryQuery(schedule_id=uuid4())
            ),
            lambda dao, p: dao.fetch_delivery(project_id=p, delivery_id=uuid4()),
        ],
        ids=["query", "query_by_schedule", "fetch"],
    )
    async def test_public_delivery_reads_leave_out_hidden_deliveries(self, read):
        capture = _Capture()
        await read(TriggersDAO(engine=_engine(capture)), uuid4())
        sql = _sql(capture.statements[0])
        assert "NOT (EXISTS (SELECT trigger_schedules.id" in sql
        assert "trigger_schedules.id = trigger_deliveries.schedule_id" in sql
        assert "trigger_schedules.project_id = trigger_deliveries.project_id" in sql
        assert "trigger_schedules.flags @> %(flags_1)s" in sql

    async def test_the_fire_path_read_finds_hidden_schedules(self):
        capture = _Capture()
        await TriggersDAO(engine=_engine(capture)).fetch_schedule_to_fire(
            project_id=uuid4(), schedule_id=uuid4()
        )
        assert "flags" not in _sql(capture.statements[0]).split("WHERE")[1]

    async def test_the_hard_delete_removes_only_a_hidden_schedule_of_the_project(self):
        capture = _Capture()
        await TriggersDAO(engine=_engine(capture)).purge_hidden_schedule(
            project_id=uuid4(), schedule_id=uuid4()
        )
        sql = _sql(capture.statements[0])
        assert sql.startswith("DELETE FROM trigger_schedules")
        assert "trigger_schedules.project_id = %(project_id_1)s" in sql
        assert "trigger_schedules.flags @> %(flags_1)s" in sql


# -- the public routes ---------------------------------------------------------------


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(uuid4()), user_id=str(uuid4()), principal=any_principal()
        )
    )


def _cron_data():
    return TriggerScheduleData(
        event_key="cron.tick",
        schedule="0 9 * * *",
        references={"workflow": {"id": str(uuid4())}},
    )


def _session_data():
    return TriggerScheduleData(
        event_key="still_running",
        run_at=_RUN_AT,
        session_id=_SESSION_ID,
        session_input=_session_input(),
    )


_REFUSED = {
    "session_target": (_session_data, TriggerScheduleFlags()),
    "is_hidden": (_cron_data, TriggerScheduleFlags(is_hidden=True)),
}


class TestPublicRoutesRefuseServerOnlyFields:
    @pytest.mark.parametrize("case", list(_REFUSED))
    async def test_create_is_refused(self, case):
        data, flags = _REFUSED[case]
        service = MagicMock(create_schedule=AsyncMock())
        router = TriggersRouter(triggers_service=service)
        router._check = AsyncMock()

        with pytest.raises(HTTPException) as refusal:
            await router.create_schedule(
                _request(),
                body=TriggerScheduleCreateRequest(
                    schedule=TriggerScheduleCreate(data=data(), flags=flags)
                ),
            )

        assert refusal.value.status_code == 422
        service.create_schedule.assert_not_awaited()

    @pytest.mark.parametrize("case", list(_REFUSED))
    async def test_edit_is_refused(self, case):
        data, flags = _REFUSED[case]
        service = MagicMock(edit_schedule=AsyncMock())
        router = TriggersRouter(triggers_service=service)
        router._check = AsyncMock()
        schedule_id = uuid4()

        with pytest.raises(HTTPException) as refusal:
            await router.edit_schedule(
                _request(),
                schedule_id=schedule_id,
                body=TriggerScheduleEditRequest(
                    schedule=TriggerScheduleEdit(
                        id=schedule_id, data=data(), flags=flags
                    )
                ),
            )

        assert refusal.value.status_code == 422
        service.edit_schedule.assert_not_awaited()

    async def test_a_visible_schedule_with_is_hidden_false_is_accepted(self):
        created = TriggerSchedule(id=uuid4(), data=_cron_data())
        service = MagicMock(create_schedule=AsyncMock(return_value=created))
        router = TriggersRouter(triggers_service=service)
        router._check = AsyncMock()

        response = await router.create_schedule(
            _request(),
            body=TriggerScheduleCreateRequest(
                schedule=TriggerScheduleCreate(
                    data=_cron_data(), flags=TriggerScheduleFlags(is_hidden=False)
                )
            ),
        )

        assert response.schedule is created
        service.create_schedule.assert_awaited_once()
