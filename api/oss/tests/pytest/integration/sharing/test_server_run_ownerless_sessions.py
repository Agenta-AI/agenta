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
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.types import SessionIdTombstoned
from oss.src.core.sharing.dtos import SharedItemKind
from oss.src.core.sharing.service import get_sharing_service
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


async def _channel_session(world) -> str:
    """An ownerless, project-visible Slack session: its row and its channel thread, as
    the channel inbox writes them (no cache entry: the decision reads the row)."""
    from uuid_utils.compat import uuid7  # noqa: PLC0415

    session_id = str(uuid4())
    await execute(
        "INSERT INTO session_streams (project_id, id, session_id, visibility) "
        "VALUES (:p, :id, :s, 'project')",
        {"p": world.project_id, "id": uuid7(), "s": session_id},
    )
    await execute(
        "INSERT INTO channel_threads (id, project_id, space_id, agent_id, session_id) "
        "VALUES (:id, :p, :space, :agent, :s)",
        {
            "id": uuid4(),
            "p": world.project_id,
            "space": uuid4(),
            "agent": uuid4(),
            "s": session_id,
        },
    )
    return session_id


async def test_a_person_sends_in_an_ownerless_project_session(world):
    """Project visibility gives members Participant (R3 option 2): Bob, sending from the
    web, runs in an evaluation's ownerless session, for the heartbeat and for a runner
    write."""
    session_id = str(uuid4())
    evaluation = _alice_run(world, RunOrigin.EVALUATION, "eval-turn")
    eval_turn = str(uuid4())
    await _beat(world, evaluation, session_id, eval_turn)  # an ownerless session
    await _beat(world, evaluation, session_id, eval_turn, running=False)

    bob_web = make_envelope(
        principal_id=world.bob,
        origin="web",
        run_id="bob-turn",
        project_id=world.project_id,
        organization_id=world.organization_id,
    )
    assert (await _beat(world, bob_web, session_id, str(uuid4()))).is_current_turn
    assert await _runner_write_allowed(world, bob_web, session_id)


async def test_a_person_s_web_send_into_a_channel_session_runs(world):
    """A project-visible channel (Slack, Telegram) session is a project session: a
    member sending from the web runs there, for the heartbeat and for a runner write.
    A project Viewer still only reads it."""
    session_id = await _channel_session(world)
    bob_web = make_envelope(
        principal_id=world.bob,
        origin="web",
        run_id="bob-turn",
        project_id=world.project_id,
        organization_id=world.organization_id,
    )
    assert (await _beat(world, bob_web, session_id, str(uuid4()))).is_current_turn
    assert await _runner_write_allowed(world, bob_web, session_id)
    assert not await _human_may(
        world, world.viewer, Permission.RUN_SESSIONS, session_id
    )
    assert await _human_may(world, world.viewer, Permission.VIEW_SESSIONS, session_id)


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


# -- the legacy shapes of the production-copy rehearsal ---------------------------------
#
# `oss000000049` makes every legacy session project-visible and names its owner
# (`test_sharing_backfill` covers that walk). These tests seed the rows as the walk
# leaves them and check what a member may do there. Under R3 option 1 each send below
# was refused (the member only read the session).


async def _backfilled_session(world, *, owner=None, turns=()) -> str:
    """A legacy session as `oss000000049` leaves it: project-visible, with `owner` (None
    for ownerless) and the given turns `(principal_id, sender_user_id, origin)`."""
    from uuid_utils.compat import uuid7  # noqa: PLC0415

    session_id, stream_id = str(uuid4()), uuid7()
    await execute(
        "INSERT INTO session_streams (project_id, id, session_id, visibility, "
        "owner_user_id) VALUES (:p, :id, :s, 'project', :o)",
        {"p": world.project_id, "id": stream_id, "s": session_id, "o": owner},
    )
    for index, (principal_id, sender_user_id, origin) in enumerate(turns):
        await execute(
            "INSERT INTO session_turns (project_id, id, session_id, stream_id, "
            "turn_index, harness_kind, principal_kind, principal_id, sender_user_id, "
            "origin, created_by_id) VALUES (:p, :id, :s, :st, :i, 'pi', :pk, :pid, "
            ":sender, :origin, :u)",
            {
                "p": world.project_id,
                "id": uuid4(),
                "s": session_id,
                "st": stream_id,
                "i": index,
                "pk": "human" if principal_id else None,
                "pid": principal_id,
                "sender": sender_user_id,
                "origin": origin,
                "u": sender_user_id,
            },
        )
    return session_id


def _web(world, user_id):
    return make_envelope(
        principal_id=user_id,
        origin="web",
        run_id=str(uuid4()),
        project_id=world.project_id,
        organization_id=world.organization_id,
    )


async def _human_may(world, user_id, action, session_id) -> bool:
    decision = await world.access.decide(
        authority=None,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id),
        action=action,
        project_id=world.project_id,
        resource=ResourceRef(kind=ResourceKind.SESSION, id=session_id),
    )
    return decision.allowed


async def _member_sends(world, user_id, session_id):
    """The member's web send runs: the heartbeat admits the turn, and the runner write
    check passes."""
    envelope, turn = _web(world, user_id), str(uuid4())
    assert await _human_may(world, user_id, Permission.RUN_SESSIONS, session_id)
    assert (await _beat(world, envelope, session_id, turn)).is_current_turn
    assert await _runner_write_allowed(world, envelope, session_id)
    await _beat(world, envelope, session_id, turn, running=False)


async def test_f1_a_member_sends_the_first_message_of_an_empty_ownerless_session(world):
    """F1: an empty legacy session with no creator stays ownerless. A member sends the
    first message."""
    session_id = await _backfilled_session(world)
    await _member_sends(world, world.bob, session_id)
    # The send still needs the role's capability: a project Viewer only reads.
    assert not await _human_may(
        world, world.viewer, Permission.RUN_SESSIONS, session_id
    )
    assert await _human_may(world, world.viewer, Permission.VIEW_SESSIONS, session_id)
    # An ownerless session has no owner to keep edits: rule S4 is unchanged.
    assert await _human_may(world, world.bob, Permission.EDIT_SESSIONS, session_id)


async def test_f3a_a_member_sends_in_a_session_whose_only_turn_is_a_child_run(world):
    """F3a: the only turn has origin child with a human sender, so the session stays
    ownerless. Its sender and another member both send."""
    session_id = await _backfilled_session(
        world, turns=[(world.alice, world.alice, "child")]
    )
    await _member_sends(world, world.bob, session_id)
    await _member_sends(world, world.alice, session_id)


async def test_f3b_the_second_sender_sends_and_edits_stay_with_the_owner(world):
    """F3b: a chat from before run principals with two senders goes to the first one.
    The second sender sends again and answers approvals (an approval answer is the
    same RUN_SESSIONS check on the session). Edit (rename, archive, delete, end the
    session) stays with the backfilled owner (rule S4): the second sender cannot edit
    it."""
    session_id = await _backfilled_session(
        world,
        owner=world.alice,
        turns=[(None, world.alice, None), (None, world.bob, None)],
    )
    await _member_sends(world, world.bob, session_id)
    assert not await _human_may(world, world.bob, Permission.EDIT_SESSIONS, session_id)
    assert await _human_may(world, world.alice, Permission.EDIT_SESSIONS, session_id)
    assert await _human_may(world, world.bob, Permission.VIEW_SESSIONS, session_id)


async def test_no_rename_creates_a_channel_thread_s_session(world):
    """A channel thread exists before its session row (the channel inbox writes the
    thread first). A rename of that id, by an API key or by a person, creates nothing:
    only the channel's own run creates the row, with the channel policy it computed
    (private to the agent's owner for a private agent). The id answers as a hidden
    session."""
    for user_id, access in (
        (
            None,
            get_sharing_service().initial_policy(
                principal=PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4()),
                origin=RunOrigin.API,
                sender_user_id=None,
                kind=SharedItemKind.SESSION,
            ),
        ),
        (world.bob, world.private_policy(world.bob)),
    ):
        session_id = await _channel_thread(world)
        with pytest.raises(SessionIdTombstoned):
            await world.streams.set_header(
                project_id=world.project_id,
                user_id=user_id,
                session_id=session_id,
                header=SessionStreamHeaderEdit(name="mine now"),
                access=access,
            )
        assert await _row(world, session_id) is None


async def _channel_thread(world) -> str:
    """A channel thread with no session row yet (the channel inbox writes the thread
    first)."""
    session_id = str(uuid4())
    await execute(
        "INSERT INTO channel_threads (id, project_id, space_id, agent_id, session_id) "
        "VALUES (:id, :p, :space, :agent, :s)",
        {
            "id": uuid4(),
            "p": world.project_id,
            "space": uuid4(),
            "agent": uuid4(),
            "s": session_id,
        },
    )
    return session_id


async def _row(world, session_id):
    return await SessionStreamsDAO(engine=get_transactions_engine()).get_by_session_id(
        project_id=world.project_id, session_id=session_id
    )


async def test_a_person_s_first_send_into_a_channel_thread_creates_nothing(world):
    """A person's first send for a channel thread's session id (the route found no
    row): the insert refuses before any lock, and no row is left."""
    from oss.src.core.sessions.streams.dtos import (  # noqa: PLC0415
        SessionStreamCommandRequest,
    )
    from oss.src.core.access.prefetch import request_memo_scope  # noqa: PLC0415
    from oss.src.core.sharing import service as sharing_module  # noqa: PLC0415

    session_id = await _channel_thread(world)

    async def recheck():
        return None

    with request_memo_scope():
        # The route's check found no row (what `session_was_missing` reads).
        sharing_module._note_missing_session(
            project_id=world.project_id, session_id=session_id
        )
        with pytest.raises(SessionIdTombstoned):
            await world.streams.command(
                project_id=world.project_id,
                user_id=world.bob,
                request=SessionStreamCommandRequest(
                    session_id=session_id,
                    data={"inputs": {"messages": [{"role": "user", "content": "hi"}]}},
                ),
                access=world.private_policy(world.bob),
                recheck=recheck,
            )
    assert await _row(world, session_id) is None
