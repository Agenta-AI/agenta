"""A refused admission at a server boundary settles the work, persisted (M3 Task 14).

`RunAdmission` runs right before each invoke. A refusal raises `AdmissionDenied`, an
`AccessDenied`, so M2's deny handling applies and is asserted here on the real rows:

- queued dispatch and approval resume: the command is `obsolete` with outcome
  `failed`, the execution is terminal with `terminal_outcome == "failed"` and
  `error.code == "access_denied"`, it is no active successor any more, and the next
  admitted input is promoted and delivered (M2 `_settle_refused_continuation`);
- trigger dispatch: one denied delivery row and the trigger paused (M2
  `TriggersDAO.refuse_delivery`), and no claim.

The commands, executions, inputs, interactions and trigger rows are real Postgres
rows. The decisions are the real `AccessService` with the real `SharingService` as
its resource policy, over in-memory memberships and sharing rows (`SharingWorld`),
so a revoked grant, a departed owner or a private agent is denied by rules S2 and A2
themselves. Only the invoke and the target resolution are fakes.
"""

import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text

import oss.src.core.access.service as access_module
import oss.src.models.db_models  # noqa: F401
from oss.src.core.access.dtos import RunApproval
from oss.src.core.access.principals import envelope_to_json
from oss.src.core.access.service import AccessService
from oss.src.core.sessions.commands.delivery import (
    deliver_continue_input,
    deliver_continue_interaction,
)
from oss.src.core.sessions.commands.dtos import (
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandState,
)
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.executions.dtos import SessionExecutionState
from oss.src.core.sessions.inputs.dtos import PendingInputCreate
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sharing.admission import RunAdmission
from oss.src.core.sharing.dtos import AccessPolicy, SessionRole, Visibility
from oss.src.core.triggers.dtos import TriggerScheduleCreate, TriggerScheduleData
from oss.src.core.workflows.dtos import ResolvedTarget
from oss.src.dbs.http.sessions.control_delivery_direct import DirectControlDelivery
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE  # noqa: F401
from oss.src.dbs.postgres.sessions.commands.dao import SessionCommandsDAO
from oss.src.dbs.postgres.sessions.executions.dao import SessionExecutionsDAO
from oss.src.dbs.postgres.sessions.inputs.dao import SessionInputsDAO
from oss.src.dbs.postgres.sessions.interactions.dao import SessionInteractionsDAO
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.src.tasks.asyncio.sessions.interactions_dispatcher import (
    InteractionsDispatcher,
)
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher
from oss.src.utils.env import env
from oss.tests.pytest.utils.memberships import RecordingRbac, make_summary
from oss.tests.pytest.utils.principals import (
    AllowingAccessService,
    InMemoryPrincipalsDAO,
    make_envelope,
)
from oss.tests.pytest.utils.sharing import SharingWorld
from integration.triggers.test_triggers_refuse_postgres import scope  # noqa: F401
from unit.sessions.test_session_commands_dao import command_scope  # noqa: F401

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _no_redis_cache(monkeypatch):
    """The stack's Redis is not reachable from the host: every cached read misses and
    reads the in-memory rows, as right after a sharing write's invalidation."""

    monkeypatch.setattr(env.agenta.api.caching, "enabled", False, raising=False)


def _private(owner):
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


class _Project:
    """The project of `project_id`: Alice, Bob and Carol are editors; the real
    `AccessService` decides with `SharingService` as its resource policy, and is the
    process's registered service (`deliverable_envelope` rechecks through it). The
    agents `shared` (no access row) and `alice-agent` (private to Alice) resolve
    through a fake `resolve_request_target`."""

    def __init__(self, *, project_id, monkeypatch):
        self.world = SharingWorld()
        self.world.project_id = project_id
        self.world.memberships_dao.add_project(
            make_summary(
                organization_id=self.world.organization_id, project_id=project_id
            )
        )
        self.project_id = project_id
        self.organization_id = self.world.organization_id
        self.principals = InMemoryPrincipalsDAO()
        self.alice = self._member()
        self.bob = self._member()
        self.carol = self._member()
        self.access = AccessService(
            memberships=self.world.service._memberships,
            rbac=RecordingRbac(enforced=True),
            principals=self.principals,
            resource_policy=self.world.service,
        )
        monkeypatch.setattr(access_module, "_access_service", self.access)
        self.shared_agent = self.world.dao.add_agent(project_id=project_id)
        self.alice_agent = self.world.dao.add_agent(
            project_id=project_id, policy=_private(self.alice)
        )
        self.agents = {"shared": self.shared_agent, "alice-agent": self.alice_agent}
        self.resolutions = 0
        self.invoked = []
        self.workflows = SimpleNamespace(
            resolve_request_target=self._resolve,
            invoke_workflow_detached=self._invoke,
        )
        self.admission = RunAdmission(
            access_service=self.access, workflows_service=self.workflows
        )

    def _member(self):
        user_id = self.world.add_member(uuid.uuid4())
        self.principals.human(user_id)
        return user_id

    def envelope(self, user_id, **kwargs):
        return make_envelope(
            principal_id=user_id,
            project_id=self.project_id,
            organization_id=self.organization_id,
            **kwargs,
        )

    async def _resolve(self, *, project_id, request):
        self.resolutions += 1
        workflow = request.references["workflow"]
        slug = workflow["slug"] if isinstance(workflow, dict) else workflow.slug
        return ResolvedTarget(artifact_id=self.agents[slug], revision_id=uuid.uuid4())

    async def _invoke(self, **kwargs):
        self.invoked.append(kwargs)
        return SimpleNamespace(run_id=kwargs.get("run_id"))


# -- rows -----------------------------------------------------------------------------


def _request(agent):
    return {
        "references": {"workflow": {"slug": agent}},
        "data": {"inputs": {"messages": [{"role": "user", "content": "hi"}]}},
    }


async def _queued_input(rows, *, envelope, agent="shared", key="k1"):
    """A promoted input with its continuation execution and `continue_input` command,
    as `_promote_next_input` leaves them."""

    engine = rows["engine"]
    inputs = SessionInputsDAO(engine=engine)
    executions = SessionExecutionsDAO(engine=engine)
    commands = SessionCommandsDAO(engine=engine)
    execution_id = str(uuid.uuid4())
    item = await inputs.create_input(
        user_id=rows["user_id"],
        pending_input=PendingInputCreate(
            project_id=rows["project_id"],
            session_id=rows["session_id"],
            content=_request(agent),
            policy="queue",
            idempotency_key=key,
            request_fingerprint=key.ljust(64, "0"),
            run_envelope=envelope,
        ),
    )
    async with commands.transaction() as transaction:
        await executions.create_continuation(
            project_id=rows["project_id"],
            session_id=rows["session_id"],
            execution_id=execution_id,
            parent_execution_id="turn-A",
            source_interaction_id=None,
            transaction=transaction,
        )
        promoted = await inputs.promote_next(
            project_id=rows["project_id"],
            session_id=rows["session_id"],
            execution_id=execution_id,
            input_id=item.id,
            transaction=transaction,
        )
        command = await commands.create_command(
            user_id=rows["user_id"],
            command=SessionCommandCreate(
                project_id=rows["project_id"],
                session_id=rows["session_id"],
                kind=SessionCommandKind.continue_input,
                target_turn_id=execution_id,
                expected_turn_id="turn-A",
                data={
                    "input_id": str(item.id),
                    "continuation_execution_id": execution_id,
                    "request": _request(agent),
                },
                idempotency_key=f"input:{item.id}",
                created_at=datetime.now(timezone.utc),
                run_envelope=promoted.run_envelope,
            ),
            transaction=transaction,
        )
        await transaction.commit()
    return command, execution_id


async def _pending_input(rows, *, envelope, agent="shared", key):
    """An input admitted while a turn runs: pending, not promoted yet."""

    return await SessionInputsDAO(engine=rows["engine"]).create_input(
        user_id=rows["user_id"],
        pending_input=PendingInputCreate(
            project_id=rows["project_id"],
            session_id=rows["session_id"],
            content=_request(agent),
            policy="queue",
            idempotency_key=key,
            request_fingerprint=key.ljust(64, "0"),
            run_envelope=envelope,
        ),
    )


async def _interaction(rows, *, envelope, agent, token):
    """A parked approval of turn-A (its execution active), with the turn's agent."""

    interaction_id = uuid.uuid4()
    async with rows["engine"].session() as session:
        await session.execute(
            text(
                "INSERT INTO session_interactions "
                "(project_id, id, session_id, turn_id, token, kind, status, data, "
                "run_envelope) VALUES (:p, :id, :s, 'turn-A', :token, "
                "'user_approval', 'pending', CAST(:d AS json), CAST(:e AS jsonb))"
            ),
            {
                "p": rows["project_id"],
                "id": interaction_id,
                "s": rows["session_id"],
                "token": token,
                "d": json.dumps({"references": {"workflow": {"slug": agent}}}),
                "e": json.dumps(envelope_to_json(envelope=envelope)),
            },
        )
        await session.execute(
            text(
                "INSERT INTO session_executions (project_id, session_id, "
                "execution_id, state) VALUES (:p, :s, 'turn-A', 'active') "
                "ON CONFLICT DO NOTHING"
            ),
            {"p": rows["project_id"], "s": rows["session_id"]},
        )
        await session.commit()
    return interaction_id


def _commands_service(rows, project, *, interactions_dispatcher=None):
    """The real commands service; its direct delivery runs the real delivery
    functions, which admit through the project's `RunAdmission`."""

    engine = rows["engine"]
    return SessionCommandsService(
        commands_dao=SessionCommandsDAO(engine=engine),
        streams_service=None,
        interactions_service=SessionInteractionsService(
            interactions_dao=SessionInteractionsDAO(engine=engine)
        ),
        lock_engine=None,
        delivery=DirectControlDelivery(
            continue_input=lambda command: deliver_continue_input(
                command=command,
                workflows_service=project.workflows,
                run_admission=project.admission,
            ),
            continue_interaction=(
                (
                    lambda command: deliver_continue_interaction(
                        command=command,
                        interactions_dispatcher=interactions_dispatcher,
                    )
                )
                if interactions_dispatcher is not None
                else None
            ),
        ),
        executions_dao=SessionExecutionsDAO(engine=engine),
        inputs_dao=SessionInputsDAO(engine=engine),
    )


async def _assert_refused(rows, *, command, execution_id):
    """The command is obsolete/failed, the execution terminal/failed with
    `access_denied`, and it is no active successor of turn-A any more."""

    stored = await SessionCommandsDAO(engine=rows["engine"]).fetch_command(
        command_id=command.id, project_id=rows["project_id"]
    )
    assert stored.state == SessionCommandState.obsolete
    assert stored.outcome == SessionCommandOutcome.failed
    executions = SessionExecutionsDAO(engine=rows["engine"])
    execution = await executions.fetch_execution(
        project_id=rows["project_id"],
        session_id=rows["session_id"],
        execution_id=execution_id,
    )
    assert execution.state == SessionExecutionState.terminal
    assert execution.terminal_outcome == "failed"
    assert execution.error["code"] == "access_denied"
    assert execution.error["retryable"] is False
    assert execution.error["details"]["reason"] == "resource_denied"
    inputs = SessionInputsDAO(engine=rows["engine"])
    async with inputs.transaction() as transaction:
        successor = await inputs.fetch_active_successor(
            project_id=rows["project_id"],
            session_id=rows["session_id"],
            transaction=transaction,
        )
    assert successor is None or successor.promoted_execution_id != execution_id


async def _assert_next_input_delivered(rows, project, *, queued, envelope):
    """The input queued behind the refused one is promoted and delivered (invoked)
    under its own envelope."""

    item = await SessionInputsDAO(engine=rows["engine"]).fetch_input(
        project_id=rows["project_id"],
        session_id=rows["session_id"],
        input_id=queued.id,
    )
    assert item.state == "promoted"
    assert [call["envelope"] for call in project.invoked] == [envelope]


def _private_session(rows, project, *, participant=None):
    state = project.world.add_session(
        policy=_private(project.alice), session_id=rows["session_id"]
    )
    if participant is not None:
        project.world.add_grant(
            state=state, user_id=participant, role=SessionRole.PARTICIPANT
        )
    return state


# -- queued dispatch ------------------------------------------------------------------


async def test_queued_input_stops_after_grant_revoked(command_scope, monkeypatch):  # noqa: F811
    """Bob is a Participant of Alice's private session and queued an input; Alice
    removes his grant. The dispatch admission refuses (rule S2): nothing is invoked,
    the work settles failed, and Alice's input queued after his runs."""

    project = _Project(project_id=command_scope["project_id"], monkeypatch=monkeypatch)
    state = _private_session(command_scope, project, participant=project.bob)
    bob = project.envelope(project.bob)
    alice = project.envelope(project.alice)
    command, execution_id = await _queued_input(command_scope, envelope=bob)
    queued = await _pending_input(command_scope, envelope=alice, key="k-alice")
    # Alice revokes Bob's grant.
    project.world.dao.grants[(project.project_id, state.stream_id)] = []

    receipt = await _commands_service(command_scope, project)._deliver(command)

    assert receipt.status == "refused" and receipt.detail == "access_denied"
    await _assert_refused(command_scope, command=command, execution_id=execution_id)
    await _assert_next_input_delivered(
        command_scope, project, queued=queued, envelope=alice
    )


async def test_queued_input_stops_after_owner_left(command_scope, monkeypatch):  # noqa: F811
    """Review Focus 3: Alice leaves the project while Bob's input is queued on her
    private session. Rule S2 needs an active owner, so Bob's input settles failed
    and nothing runs; Carol's input queued behind it is promoted, and refused the
    same way (private session, no access), so the queue drains without a run."""

    project = _Project(project_id=command_scope["project_id"], monkeypatch=monkeypatch)
    _private_session(command_scope, project, participant=project.bob)
    command, execution_id = await _queued_input(
        command_scope, envelope=project.envelope(project.bob)
    )
    queued = await _pending_input(
        command_scope, envelope=project.envelope(project.carol), key="k-carol"
    )
    project.world.remove_member(project.alice)

    receipt = await _commands_service(command_scope, project)._deliver(command)

    assert receipt.status == "refused"
    await _assert_refused(command_scope, command=command, execution_id=execution_id)
    assert project.invoked == []
    item = await SessionInputsDAO(engine=command_scope["engine"]).fetch_input(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        input_id=queued.id,
    )
    assert item.state == "promoted"


async def test_queued_input_into_a_private_agent_settles_failed(
    command_scope,  # noqa: F811
    monkeypatch,
):
    """Bob's own session (project-visible); his queued input names Alice's private
    agent (rule A2): refused and settled, and his next input (the shared agent)
    runs."""

    project = _Project(project_id=command_scope["project_id"], monkeypatch=monkeypatch)
    project.world.add_session(
        policy=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=project.bob),
        session_id=command_scope["session_id"],
    )
    bob = project.envelope(project.bob)
    command, execution_id = await _queued_input(
        command_scope, envelope=bob, agent="alice-agent"
    )
    queued = await _pending_input(command_scope, envelope=bob, key="k-bob-next")

    receipt = await _commands_service(command_scope, project)._deliver(command)

    assert receipt.status == "refused"
    await _assert_refused(command_scope, command=command, execution_id=execution_id)
    await _assert_next_input_delivered(
        command_scope, project, queued=queued, envelope=bob
    )


async def test_each_boundary_resolves_the_target_once(command_scope, monkeypatch):  # noqa: F811
    """An admitted queued input: the admission resolves the target once, and the
    invoke receives the request it resolved (`_prepare_invoke` finds the revision on
    it and does not resolve again)."""

    project = _Project(project_id=command_scope["project_id"], monkeypatch=monkeypatch)
    _private_session(command_scope, project, participant=project.bob)
    command, _ = await _queued_input(
        command_scope, envelope=project.envelope(project.bob)
    )

    receipt = await _commands_service(command_scope, project)._deliver(command)

    assert receipt is None or receipt.status != "refused"
    assert project.resolutions == 1
    assert len(project.invoked) == 1


# -- approval resume ------------------------------------------------------------------


async def test_resume_stops_when_alice_lost_agent(command_scope, monkeypatch):  # noqa: F811
    """Alice's parked run on the `shared` agent; Carol takes the agent over and makes
    it private. Alice approves: the resume admission refuses (rule A2), the
    continuation settles failed, and the input queued behind it is delivered."""

    project = _Project(project_id=command_scope["project_id"], monkeypatch=monkeypatch)
    project.world.add_session(
        policy=_private(project.alice), session_id=command_scope["session_id"]
    )
    alice = project.envelope(project.alice, run_id="turn-A")
    interaction_id = await _interaction(
        command_scope, envelope=alice, agent="shared", token="m3-resume"
    )
    next_envelope = project.envelope(project.alice)
    queued = await _pending_input(
        command_scope, envelope=next_envelope, agent="alice-agent", key="k-next"
    )
    # Carol owns the agent now, and it is private.
    project.world.dao.agents[(project.project_id, project.shared_agent)] = _private(
        project.carol
    )
    dispatch = AsyncMock(return_value="run-1")
    dispatcher = InteractionsDispatcher(
        run_admission=project.admission,
        workflows_service=project.workflows,
        interactions_service=SessionInteractionsService(
            interactions_dao=SessionInteractionsDAO(engine=command_scope["engine"])
        ),
        dispatch_fn=dispatch,
    )
    service = _commands_service(
        command_scope, project, interactions_dispatcher=dispatcher
    )

    admission = await service.respond_interaction(
        project_id=command_scope["project_id"],
        user_id=project.alice,
        interaction_id=interaction_id,
        answer={"approved": True},
        expected_execution_id=None,
        idempotency_key="answer-m3-resume",
        approved_by=RunApproval(
            principal=alice.authority.principal, user_id=project.alice
        ),
    )

    dispatch.assert_not_awaited()
    await _assert_refused(
        command_scope,
        command=admission.command,
        execution_id=admission.execution_id,
    )
    await _assert_next_input_delivered(
        command_scope, project, queued=queued, envelope=next_envelope
    )


# -- trigger dispatch -----------------------------------------------------------------


async def test_environment_trigger_private_target_paused(scope, monkeypatch):  # noqa: F811
    """Bob's schedule targets an environment that now deploys Alice's private agent.
    The tick resolves the target, the admission refuses it (rule A2), and M2's one
    operation writes the denied delivery and pauses the schedule; nothing is
    claimed or run."""

    project = _Project(project_id=scope["project"], monkeypatch=monkeypatch)
    triggers = TriggersDAO(engine=get_transactions_engine())
    bob = project.envelope(project.bob)
    schedule = await triggers.create_schedule(
        project_id=scope["project"],
        user_id=scope["user"],
        principal=bob.authority.principal,
        artifact_id=None,
        schedule=TriggerScheduleCreate(
            name="m3-private-target",
            data=TriggerScheduleData(
                event_key="cron.tick",
                schedule="0 0 1 1 *",
                references={
                    "environment": {"slug": "production"},
                    "workflow": {"slug": "alice-agent"},
                },
            ),
        ),
    )
    dispatch = AsyncMock(return_value="run-1")
    dispatcher = TriggersDispatcher(
        triggers_dao=triggers,
        session_claims_dao=SessionStreamsDAO(engine=get_transactions_engine()),
        workflows_service=project.workflows,
        run_admission=project.admission,
        dispatch_fn=dispatch,
        access_service=AllowingAccessService(organization_id=project.organization_id),
        sharing_service=project.world.service,
    )

    await dispatcher.dispatch_schedule(
        project_id=scope["project"], schedule=schedule, event_id="tick-1", event={}
    )

    dispatch.assert_not_awaited()
    async with get_transactions_engine().session() as session:
        deliveries = (
            (
                await session.execute(
                    text(
                        "SELECT status, data FROM trigger_deliveries "
                        "WHERE project_id = :p"
                    ),
                    {"p": scope["project"]},
                )
            )
            .mappings()
            .all()
        )
        row = (
            (
                await session.execute(
                    text("SELECT flags, meta FROM trigger_schedules WHERE id = :id"),
                    {"id": schedule.id},
                )
            )
            .mappings()
            .one()
        )
        claimed = (
            await session.execute(
                text("SELECT count(*) FROM session_streams WHERE project_id = :p"),
                {"p": scope["project"]},
            )
        ).scalar_one()
    assert len(deliveries) == 1
    assert deliveries[0]["status"]["code"] == "403"
    details = deliveries[0]["data"]["error_details"]
    assert details["code"] == "access_denied"
    assert details["details"]["reason"] == "resource_denied"
    assert row["flags"]["is_active"] is False
    assert row["meta"]["paused_reason"] == "access_denied"
    assert claimed == 0
