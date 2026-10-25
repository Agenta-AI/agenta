# ruff: noqa: F811  (the imported `world` fixture is a test parameter)
"""Server runs of a person in the ownerless sessions they create (v0.125.0 release QA,
risk map R1 and R2).

An event subscription a person created, a child run (an agent tool) and an evaluation
run all run as that person (a human principal) and create an ownerless, project-visible
session (CONTRACT section 7). The ownerless-session rule "humans only read" is about
people sending in a session; it must not refuse the person's own server run, which acts
through a server-signed run credential with origin subscription, child or evaluation.

Every case goes through the real services: the real dispatcher claim (subscription), the
real heartbeat with the real `RunAdmission`, `AccessService` and `SharingService` over
Postgres and a real Redis, and the runner write check (`check_request` with the run
credential). An interactive human send (web origin) into an ownerless session stays
refused.

Run with a throwaway Redis, like the statement-count tests (see that module).
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import (
    PrincipalKind,
    PrincipalRef,
    ResourceKind,
    ResourceRef,
    RunOrigin,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.principals import child_envelope, stored_work_envelope
from oss.src.core.sessions.streams.dtos import SessionHeartbeatRequest
from oss.src.core.sharing.dtos import SharedItemKind
from oss.src.core.sharing.service import get_sharing_service
from oss.src.core.sharing.types import AdmissionDenied
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.integration.sharing.test_sharing_query_counts_postgres import (  # noqa: F401
    redis_commands,
    world,
)
from oss.tests.pytest.utils.membership_seed import execute
from oss.tests.pytest.utils.principals import make_envelope, make_request_access

pytestmark = pytest.mark.integration


def _beat(world, envelope, session_id, turn_id, *, running=True, access=None):
    return world.streams.heartbeat(
        project_id=world.project_id,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="r1-r2",
            turn_id=turn_id,
            is_running=running,
            references=world.refs[world.shared_agent],
        ),
        runner_verified=False,
        envelope=envelope,
        access=access
        or get_sharing_service().initial_policy(
            principal=envelope.authority.principal,
            origin=envelope.context.origin,
            sender_user_id=envelope.sender.user_id if envelope.sender else None,
            kind=SharedItemKind.SESSION,
        ),
        run_admission=world.admission,
        admission_envelope=envelope,
    )


async def _runner_write_allowed(world, envelope, session_id) -> bool:
    """The full check of a runner write (no admission record): `check_request` with the
    run credential, as `allow_session_write` runs it."""
    access = make_request_access(envelope=envelope, credential_kind="run_credential")
    token = set_request_access(access)
    try:
        decision = await world.access.check_request(
            access=access,
            action=Permission.RUN_SESSIONS,
            project_id=world.project_id,
            resource=ResourceRef(kind=ResourceKind.SESSION, id=session_id),
        )
    finally:
        reset_request_access(token)
    return decision.allowed


def _alice_run(world, origin: RunOrigin, run_id: str):
    envelope = stored_work_envelope(
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=world.alice),
        organization_id=world.organization_id,
        project_id=world.project_id,
        origin=origin,
        origin_id=str(uuid4()),
        created_by_id=world.alice,
    )
    return envelope.model_copy(
        update={"context": envelope.context.model_copy(update={"run_id": run_id})}
    )


async def _a_whole_run(world, envelope, session_id, *, create_access=None):
    """First beat, steady beat, end beat, then a second turn and its end beat: all
    admitted; the runner write check passes."""
    turn = str(uuid4())
    first = await _beat(world, envelope, session_id, turn, access=create_access)
    assert first.is_current_turn
    await _beat(world, envelope, session_id, turn)
    await _beat(world, envelope, session_id, turn, running=False)
    assert await _runner_write_allowed(world, envelope, session_id)
    second = str(uuid4())
    again = await _beat(world, envelope, session_id, second)
    assert again.is_current_turn
    await _beat(world, envelope, session_id, second, running=False)


async def test_a_person_s_event_subscription_runs_in_its_session(world):
    """R1 through the real dispatcher: Alice's subscription claims an ownerless session,
    and the runner's beats with the run credential of that delivery are admitted."""
    from oss.src.core.triggers.dtos import (
        TriggerSubscriptionCreate,
        TriggerSubscriptionData,
    )
    import oss.src.dbs.postgres.gateway.connections.dbes  # noqa: F401  (the FK target)
    from oss.src.dbs.postgres.triggers.dao import TriggersDAO
    from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher

    connection_id = uuid4()
    await execute(
        "INSERT INTO gateway_connections (project_id, id, slug, provider_key, "
        "integration_key) VALUES (:p, :id, :slug, 'composio', 'gmail')",
        {"p": world.project_id, "id": connection_id, "slug": f"r1-{uuid4().hex[:8]}"},
    )
    engine = get_transactions_engine()
    triggers = TriggersDAO(engine=engine)
    subscription = await triggers.create_subscription(
        project_id=world.project_id,
        user_id=world.alice,
        subscription=TriggerSubscriptionCreate(
            name="r1",
            connection_id=connection_id,
            data=TriggerSubscriptionData(
                event_key="gmail.new_message",
                references={"workflow": {"id": str(world.shared_agent)}},
            ),
        ),
        trigger_id=f"r1-{uuid4().hex[:8]}",
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=world.alice),
        artifact_id=world.shared_agent,
    )
    await execute(
        "UPDATE trigger_subscriptions SET flags = jsonb_set(coalesce(flags, '{}'), "
        "'{is_valid}', 'true') WHERE project_id = :p AND id = :id",
        {"p": world.project_id, "id": subscription.id},
    )
    subscription = await triggers.fetch_subscription(
        project_id=world.project_id, subscription_id=subscription.id
    )
    dispatch = AsyncMock(return_value="run-1")
    try:
        await TriggersDispatcher(
            run_admission=world.admission,
            triggers_dao=triggers,
            session_claims_dao=SessionStreamsDAO(engine=engine),
            workflows_service=world.workflows,
            dispatch_fn=dispatch,
            access_service=world.access,
        ).dispatch_subscription(
            project_id=world.project_id,
            subscription=subscription,
            event_id=f"evt-{uuid4().hex[:8]}",
            event={},
        )
        dispatch.assert_awaited_once()
        sent = dispatch.await_args.kwargs
        envelope = sent["envelope"]
        assert envelope.context.origin == RunOrigin.SUBSCRIPTION
        assert envelope.authority.principal.kind == PrincipalKind.HUMAN
        session_id = sent["request"].session_id
        # The claim made the row: ownerless, project-visible.
        row = await SessionStreamsDAO(engine=engine).get_by_session_id(
            project_id=world.project_id, session_id=session_id
        )
        assert row is not None
        run = envelope.model_copy(
            update={"context": envelope.context.model_copy(update={"run_id": "t-1"})}
        )
        await _a_whole_run(world, run, session_id)
    finally:
        await execute(
            "DELETE FROM trigger_subscriptions WHERE project_id = :p",
            {"p": world.project_id},
        )
        await execute(
            "DELETE FROM gateway_connections WHERE project_id = :p",
            {"p": world.project_id},
        )


@pytest.mark.parametrize("origin", [RunOrigin.CHILD, RunOrigin.EVALUATION])
async def test_a_person_s_child_or_evaluation_run_runs_in_its_session(world, origin):
    """R2: the child run (the parent's principal, origin child) and the evaluation run
    (the run's person, origin evaluation) create an ownerless session with their first
    beat; their end beat, their runner writes and their next turn are admitted too."""
    if origin == RunOrigin.CHILD:
        parent = make_envelope(
            principal_id=world.alice,
            origin="web",
            run_id="parent-turn",
            project_id=world.project_id,
            organization_id=world.organization_id,
        )
        envelope = child_envelope(parent=parent).model_copy(
            update={
                "context": child_envelope(parent=parent).context.model_copy(
                    update={"run_id": "child-turn"}
                )
            }
        )
    else:
        envelope = _alice_run(world, RunOrigin.EVALUATION, "eval-turn")
    await _a_whole_run(world, envelope, str(uuid4()))


async def test_a_person_s_web_send_into_an_ownerless_session_stays_refused(world):
    """The rule the fix keeps: a person sending interactively (web origin) in an
    ownerless session only reads it, for the heartbeat and for a runner write."""
    session_id = str(uuid4())
    evaluation = _alice_run(world, RunOrigin.EVALUATION, "eval-turn")
    await _beat(world, evaluation, session_id, str(uuid4()))  # an ownerless session

    bob_web = make_envelope(
        principal_id=world.bob,
        origin="web",
        run_id="bob-turn",
        project_id=world.project_id,
        organization_id=world.organization_id,
    )
    with pytest.raises(AdmissionDenied):
        await _beat(world, bob_web, session_id, str(uuid4()))
    assert not await _runner_write_allowed(world, bob_web, session_id)


async def test_another_person_s_server_run_is_refused_in_a_private_session(world):
    """The origin opens ownerless sessions only: Bob's evaluation run cannot write to
    Alice's private session."""
    session_id = str(uuid4())
    alice_web = make_envelope(
        principal_id=world.alice,
        origin="web",
        run_id="alice-turn",
        project_id=world.project_id,
        organization_id=world.organization_id,
    )
    await _beat(world, alice_web, session_id, str(uuid4()))  # private, owned by Alice
    bob_eval = stored_work_envelope(
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=world.bob),
        organization_id=world.organization_id,
        project_id=world.project_id,
        origin=RunOrigin.EVALUATION,
        origin_id=str(uuid4()),
        created_by_id=world.bob,
    )
    assert not await _runner_write_allowed(world, bob_eval, session_id)


async def test_a_server_run_s_admission_does_not_open_its_turn_to_the_person(world):
    """Alice's evaluation run is admitted for turn T of its ownerless session. Alice's
    own web run (same principal, origin web) beating turn T gets no continuity from
    that record: its beat is checked, and refused (she only reads the session)."""
    session_id = str(uuid4())
    turn = str(uuid4())
    evaluation = _alice_run(world, RunOrigin.EVALUATION, turn)
    first = await _beat(world, evaluation, session_id, turn)
    assert first.is_current_turn

    alice_web = make_envelope(
        principal_id=world.alice,
        origin="web",
        run_id=turn,
        project_id=world.project_id,
        organization_id=world.organization_id,
    )
    with pytest.raises(AdmissionDenied):
        await _beat(world, alice_web, session_id, turn)
