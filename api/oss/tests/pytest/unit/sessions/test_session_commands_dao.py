"""The compare-and-set rules that make a command safe under concurrency.

These run against a real Postgres, because what is being tested IS the database's behaviour:
a unique constraint, a partial index's predicate, `FOR UPDATE SKIP LOCKED`, and an `UPDATE ...
WHERE <expected state> RETURNING *` that must be won by exactly one caller.

The rule every one of them protects: one execution reaches exactly one terminal outcome,
written by exactly one writer.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text

from oss.src.core.sessions.commands.dtos import (
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandSettle,
    SessionCommandState,
)
from oss.src.core.sessions.commands.interfaces import SessionScope
from oss.src.core.sessions.commands.interfaces import DeliveryReceipt
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.commands.types import (
    ExecutionExpectationFailed,
    IdempotencyKeyReused,
    InteractionResponseConflict,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.postgres.sessions.commands.dao import SessionCommandsDAO
from oss.src.dbs.postgres.sessions.executions.dao import SessionExecutionsDAO
from oss.src.core.sessions.executions.dtos import SessionExecutionState
from oss.src.core.sessions.interactions.dtos import (
    SessionInteractionStatus,
    SessionInteractionTransition,
)
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.dbs.postgres.sessions.interactions.dao import SessionInteractionsDAO
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
import oss.src.models.db_models  # noqa: F401
from oss.src.utils.env import env


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def command_scope():
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()
    session_id = f"cmd-dao-{project_id.hex[:12]}"

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "command-dao-test",
                "email": f"command-dao-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "command-dao-test-org",
                "owner_id": user_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "command-dao-test-workspace",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :project_name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "project_name": "command-dao-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        # The session row the command's `stopping_turn_id` is stamped on.
        await session.execute(
            text(
                "INSERT INTO session_streams (id, project_id, session_id, turn_id) "
                "VALUES (:id, :project_id, :session_id, :turn_id)"
            ),
            {
                "id": uuid.uuid4(),
                "project_id": project_id,
                "session_id": session_id,
                "turn_id": "turn-A",
            },
        )
        await session.commit()

    yield {
        "engine": engine,
        "project_id": project_id,
        "user_id": user_id,
        "session_id": session_id,
    }


def _create(scope, **overrides) -> SessionCommandCreate:
    payload = dict(
        project_id=scope["project_id"],
        session_id=scope["session_id"],
        kind=SessionCommandKind.cancel,
        target_turn_id="turn-A",
        state=SessionCommandState.pending,
        created_at=datetime.now(timezone.utc),
    )
    payload.update(overrides)
    return SessionCommandCreate(**payload)


async def _stopping_turn_id(scope) -> str:
    async with scope["engine"].session() as session:
        result = await session.execute(
            text(
                "SELECT stopping_turn_id FROM session_streams "
                "WHERE project_id = :project_id AND session_id = :session_id"
            ),
            {"project_id": scope["project_id"], "session_id": scope["session_id"]},
        )
        return result.scalar()


async def test_the_command_and_the_stopping_marker_are_written_together(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])

    command = await dao.create_command(
        user_id=command_scope["user_id"],
        command=_create(command_scope),
        stopping_turn_id="turn-A",
    )

    assert command.state == SessionCommandState.pending
    # A session that renders as plainly running while a command exists to stop it is a session
    # nothing later reconciles, so the two writes share one transaction.
    assert await _stopping_turn_id(command_scope) == "turn-A"


async def test_a_repeated_idempotency_key_returns_the_first_row(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])

    first = await dao.create_command(
        user_id=command_scope["user_id"],
        command=_create(command_scope, idempotency_key="retry-me"),
    )
    second = await dao.create_command(
        user_id=command_scope["user_id"],
        command=_create(command_scope, idempotency_key="retry-me"),
    )

    assert second.id == first.id
    assert (
        await dao.count_open(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
        )
        == 1
    )


async def test_concurrent_shared_transactions_replay_one_idempotent_command(
    command_scope,
):
    dao = SessionCommandsDAO(engine=command_scope["engine"])

    async def insert():
        async with command_scope["engine"].session() as transaction:
            return await dao.create_command(
                user_id=command_scope["user_id"],
                command=_create(command_scope, idempotency_key="shared-retry"),
                transaction=transaction,
            )

    first, second = await asyncio.wait_for(
        asyncio.gather(insert(), insert()), timeout=5
    )

    assert first.id == second.id
    assert (
        await dao.count_open(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
        )
        == 1
    )


async def test_two_open_commands_for_one_execution_collapse_to_one(command_scope):
    # Two Stops for the same execution are one intent, even with no idempotency key and even
    # when admission's own read cannot see the other because it has not committed yet. The
    # database refuses the second insert and the DAO answers with the command that exists.
    dao = SessionCommandsDAO(engine=command_scope["engine"])

    first = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )
    second = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )

    assert second.id == first.id
    assert (
        await dao.count_open(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
        )
        == 1
    )


async def test_two_concurrent_admissions_still_yield_one_command(command_scope):
    # The race the unique index exists for: both inserts run before either commits.
    dao = SessionCommandsDAO(engine=command_scope["engine"])

    first, second = await asyncio.wait_for(
        asyncio.gather(
            dao.create_command(
                user_id=command_scope["user_id"], command=_create(command_scope)
            ),
            dao.create_command(
                user_id=command_scope["user_id"], command=_create(command_scope)
            ),
            return_exceptions=True,
        ),
        timeout=30,
    )

    ids = {r.id for r in (first, second) if not isinstance(r, Exception)}
    assert len(ids) == 1, f"expected one command, got {first!r} and {second!r}"


async def test_a_settled_command_does_not_block_a_new_one(command_scope):
    # The unique index is partial on the OPEN states, so once a Stop has settled the next Stop
    # against the same execution is a fresh command, not a constraint violation.
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    first = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )
    await dao.settle_command(
        settle=SessionCommandSettle(
            project_id=command_scope["project_id"],
            command_id=first.id,
            state=SessionCommandState.applied,
            outcome=SessionCommandOutcome.stopped,
            expected_states=[SessionCommandState.pending],
            replica_id=None,
        )
    )

    second = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )

    assert second.id != first.id


async def test_the_open_command_read_finds_only_the_same_target(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    await dao.create_command(
        user_id=command_scope["user_id"],
        command=_create(command_scope, target_turn_id="turn-A"),
    )

    same = await dao.fetch_open_command(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        kind=SessionCommandKind.cancel,
        target_turn_id="turn-A",
    )
    other = await dao.fetch_open_command(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        kind=SessionCommandKind.cancel,
        target_turn_id="turn-B",
    )

    assert same is not None
    assert other is None, "a different execution is a different intent"


async def test_a_settled_command_is_no_longer_open(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    command = await dao.create_command(
        user_id=command_scope["user_id"],
        command=_create(
            command_scope,
            state=SessionCommandState.obsolete,
            outcome=SessionCommandOutcome.not_running,
            settled_at=datetime.now(timezone.utc),
        ),
    )

    assert command.state == SessionCommandState.obsolete
    assert (
        await dao.fetch_open_command(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            kind=SessionCommandKind.cancel,
            target_turn_id="turn-A",
        )
        is None
    )


async def test_two_concurrent_claims_of_one_command_yield_exactly_one_winner(
    command_scope,
):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )
    scopes = [
        SessionScope(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
        )
    ]

    # Bounded: both calls contend for the same row on separate pooled connections, so a
    # regression that drops SKIP LOCKED would hang the run rather than fail it.
    first, second = await asyncio.wait_for(
        asyncio.gather(
            dao.claim_commands(
                sessions=scopes, replica_id="replica-1", lease_seconds=90, limit=10
            ),
            dao.claim_commands(
                sessions=scopes, replica_id="replica-2", lease_seconds=90, limit=10
            ),
        ),
        timeout=30,
    )

    assert len(first) + len(second) == 1, (
        "a command is delivered to one replica, not two"
    )


async def test_a_claim_ignores_sessions_the_caller_did_not_declare(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )

    claimed = await dao.claim_commands(
        sessions=[
            SessionScope(
                project_id=command_scope["project_id"], session_id="a-different-session"
            )
        ],
        replica_id="replica-1",
        lease_seconds=90,
        limit=10,
    )

    assert claimed == []


async def test_the_claim_records_the_lease_and_counts_the_delivery(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    command = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )
    attempted = await dao.record_delivery_attempt(
        project_id=command_scope["project_id"],
        command_id=command.id,
        now=datetime.now(timezone.utc),
        max_deliveries=3,
    )
    assert attempted is not None

    claimed = await dao.claim_for_delivery(
        project_id=command_scope["project_id"],
        command_id=command.id,
        replica_id="replica-1",
        lease_seconds=90,
    )

    assert claimed is not None
    assert claimed.state == SessionCommandState.claimed
    assert claimed.claimed_by == "replica-1"
    assert claimed.claim_count == 1
    assert claimed.claim_expires_at is not None
    assert claimed.claim_expires_at > datetime.now(timezone.utc) + timedelta(seconds=60)


async def test_a_second_delivery_claim_finds_nothing_to_take(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    command = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )
    await dao.claim_for_delivery(
        project_id=command_scope["project_id"],
        command_id=command.id,
        replica_id="replica-1",
        lease_seconds=90,
    )

    again = await dao.claim_for_delivery(
        project_id=command_scope["project_id"],
        command_id=command.id,
        replica_id="replica-2",
        lease_seconds=90,
    )

    assert again is None


async def test_only_the_replica_holding_the_claim_may_settle(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    command = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )
    await dao.claim_for_delivery(
        project_id=command_scope["project_id"],
        command_id=command.id,
        replica_id="replica-1",
        lease_seconds=90,
    )

    wrong = await dao.settle_command(
        settle=SessionCommandSettle(
            project_id=command_scope["project_id"],
            command_id=command.id,
            state=SessionCommandState.applied,
            outcome=SessionCommandOutcome.stopped,
            replica_id="replica-2",
        )
    )

    assert wrong is None
    stored = await dao.fetch_command(command_id=command.id)
    assert stored.state == SessionCommandState.claimed, "the stored state is unchanged"


async def test_settling_an_already_terminal_command_changes_nothing(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    command = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )
    await dao.claim_for_delivery(
        project_id=command_scope["project_id"],
        command_id=command.id,
        replica_id="replica-1",
        lease_seconds=90,
    )
    settled = await dao.settle_command(
        settle=SessionCommandSettle(
            project_id=command_scope["project_id"],
            command_id=command.id,
            state=SessionCommandState.applied,
            outcome=SessionCommandOutcome.stopped,
            replica_id="replica-1",
        )
    )
    assert settled is not None

    repeat = await dao.settle_command(
        settle=SessionCommandSettle(
            project_id=command_scope["project_id"],
            command_id=command.id,
            state=SessionCommandState.obsolete,
            outcome=SessionCommandOutcome.failed,
            replica_id="replica-1",
        )
    )

    assert repeat is None, "one execution, one terminal outcome, one writer"
    stored = await dao.fetch_command(command_id=command.id)
    assert stored.outcome == SessionCommandOutcome.stopped


async def test_the_api_can_settle_a_pending_command_nobody_took(command_scope):
    # The `not_held` case: a reachable runner said it does not hold the session, so there is no
    # claim to guard on and the API settles it itself.
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    command = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )

    settled = await dao.settle_command(
        settle=SessionCommandSettle(
            project_id=command_scope["project_id"],
            command_id=command.id,
            state=SessionCommandState.obsolete,
            outcome=SessionCommandOutcome.not_running,
            expected_states=[SessionCommandState.pending],
            replica_id=None,
        )
    )

    assert settled is not None
    assert settled.outcome == SessionCommandOutcome.not_running


async def test_the_runner_can_find_a_command_without_a_project_id(command_scope):
    # The runner reports an outcome with the command id alone; it holds no project credential.
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    command = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )

    found = await dao.fetch_command(command_id=command.id)

    assert found is not None
    assert found.project_id == command_scope["project_id"]


async def test_clearing_the_stopping_marker_is_scoped_to_the_turn_it_set(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    await dao.create_command(
        user_id=command_scope["user_id"],
        command=_create(command_scope),
        stopping_turn_id="turn-A",
    )

    # A settlement for an OLDER turn must not clear a newer Stop's marker.
    await dao.clear_stopping_turn(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        turn_id="turn-older",
    )
    assert await _stopping_turn_id(command_scope) == "turn-A"

    await dao.clear_stopping_turn(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        turn_id="turn-A",
    )
    assert await _stopping_turn_id(command_scope) is None


async def test_expire_claims_returns_only_leases_that_have_passed(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    fresh = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )
    await dao.claim_for_delivery(
        project_id=command_scope["project_id"],
        command_id=fresh.id,
        replica_id="replica-1",
        lease_seconds=90,
    )

    # The sweep is deliberately NOT project-scoped: it settles every abandoned claim in the
    # deployment, so assert on this command's presence rather than on the whole result.
    now = datetime.now(timezone.utc)
    assert fresh.id not in {
        row.id for row in await dao.expire_claims(now=now, max_deliveries=3)
    }, "a lease that has not passed is not swept"
    # An hour later the same lease has passed, and the settlement sweep sees it.
    later = await dao.expire_claims(now=now + timedelta(hours=1), max_deliveries=3)
    assert fresh.id in {row.id for row in later}


async def test_old_pending_commands_are_returned_for_redelivery(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    now = datetime.now(timezone.utc)
    command = await dao.create_command(
        user_id=command_scope["user_id"],
        # The integration database is intentionally reused between runs. Put this row ahead of
        # any accumulated abandoned-command backlog so the DAO's production batch limit does not
        # make the assertion depend on how many earlier test runs used the same database.
        command=_create(
            command_scope,
            created_at=datetime(1970, 1, 1, tzinfo=timezone.utc),
        ),
    )

    rows = await dao.expire_claims(
        now=now,
        max_deliveries=3,
        pending_before=now - timedelta(seconds=90),
    )

    assert command.id in {row.id for row in rows}


async def test_delivery_attempts_are_bounded_in_the_database(command_scope):
    dao = SessionCommandsDAO(engine=command_scope["engine"])
    command = await dao.create_command(
        user_id=command_scope["user_id"], command=_create(command_scope)
    )
    now = datetime.now(timezone.utc)

    first = await dao.record_delivery_attempt(
        project_id=command_scope["project_id"],
        command_id=command.id,
        now=now,
        max_deliveries=1,
    )
    second = await dao.record_delivery_attempt(
        project_id=command_scope["project_id"],
        command_id=command.id,
        now=now + timedelta(seconds=1),
        max_deliveries=1,
    )

    assert first is not None
    assert first.claim_count == 1
    assert second is None


async def test_runner_and_watchdog_have_one_terminal_winner(command_scope):
    dao = SessionExecutionsDAO(engine=command_scope["engine"])

    runner, watchdog = await asyncio.gather(
        dao.settle(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            execution_id="turn-A",
            terminal_outcome="stopped",
            settled_by="runner",
        ),
        dao.settle(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            execution_id="turn-A",
            terminal_outcome="lost",
            settled_by="watchdog",
        ),
    )

    assert sum(result.won for result in (runner, watchdog)) == 1
    assert runner.settlement == watchdog.settlement


async def test_repeating_the_same_execution_settlement_reports_only_the_insert_as_winner(
    command_scope,
):
    dao = SessionExecutionsDAO(engine=command_scope["engine"])

    first = await dao.settle(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        execution_id="turn-A",
        terminal_outcome="lost",
        settled_by="watchdog",
    )
    repeated = await dao.settle(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        execution_id="turn-A",
        terminal_outcome="lost",
        settled_by="watchdog",
    )

    assert first.won is True
    assert repeated.won is False
    assert repeated.settlement == first.settlement


async def test_execution_ending_marker_is_one_way(command_scope):
    dao = SessionExecutionsDAO(engine=command_scope["engine"])
    await dao.settle(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        execution_id="turn-A",
        terminal_outcome="stopped",
        settled_by="runner",
    )
    written_at = datetime.now(timezone.utc)

    await dao.mark_endings_written(
        project_id=command_scope["project_id"],
        keys=[(command_scope["session_id"], "turn-A")],
        written_at=written_at,
    )
    await dao.mark_endings_written(
        project_id=command_scope["project_id"],
        keys=[(command_scope["session_id"], "turn-A")],
        written_at=written_at + timedelta(seconds=1),
    )

    stored = await dao.query_settled(
        project_id=command_scope["project_id"],
        keys=[(command_scope["session_id"], "turn-A")],
    )
    assert (
        stored[(command_scope["session_id"], "turn-A")].ending_written_at == written_at
    )


async def _insert_pending_interaction(scope, *, token: str):
    interaction_id = uuid.uuid4()
    async with scope["engine"].session() as session:
        await session.execute(
            text(
                "INSERT INTO session_interactions "
                "(project_id, id, session_id, turn_id, token, kind, status) "
                "VALUES (:project_id, :id, :session_id, 'turn-A', :token, "
                "'user_approval', 'pending')"
            ),
            {
                "project_id": scope["project_id"],
                "id": interaction_id,
                "session_id": scope["session_id"],
                "token": token,
            },
        )
    return interaction_id


class _UnreachableDelivery:
    async def deliver(self, **kwargs):
        return DeliveryReceipt(status="unreachable")

    async def acknowledge(self, **kwargs):
        return None


def _commands_service(scope, *, executions=None):
    interactions = SessionInteractionsDAO(engine=scope["engine"])
    service = SessionCommandsService(
        commands_dao=SessionCommandsDAO(engine=scope["engine"]),
        streams_service=None,
        interactions_service=SessionInteractionsService(interactions_dao=interactions),
        lock_engine=None,
        delivery=_UnreachableDelivery(),
        executions_dao=executions or SessionExecutionsDAO(engine=scope["engine"]),
    )
    service._resolve_target = AsyncMock(return_value=("turn-A", None))
    return service


async def test_full_service_stop_and_answer_have_one_postgres_winner(command_scope):
    interaction_id = await _insert_pending_interaction(
        command_scope, token="service-race"
    )
    service = _commands_service(command_scope)

    results = await asyncio.gather(
        service.request_cancel(
            project_id=command_scope["project_id"],
            user_id=command_scope["user_id"],
            session_id=command_scope["session_id"],
            expected_execution_id="turn-A",
            idempotency_key="stop-race",
        ),
        service.respond_interaction(
            project_id=command_scope["project_id"],
            user_id=command_scope["user_id"],
            interaction_id=interaction_id,
            answer={"approved": True},
            expected_execution_id="turn-A",
            idempotency_key="answer-race",
        ),
        return_exceptions=True,
    )

    assert sum(not isinstance(result, Exception) for result in results) == 1
    loser = next(result for result in results if isinstance(result, Exception))
    assert isinstance(loser, (ExecutionExpectationFailed, InteractionResponseConflict))

    interaction = await SessionInteractionsDAO(
        engine=command_scope["engine"]
    ).fetch_interaction(
        project_id=command_scope["project_id"], interaction_id=interaction_id
    )
    assert interaction.status in (
        SessionInteractionStatus.cancelled,
        SessionInteractionStatus.responded,
    )


async def test_full_service_stop_between_parallel_answers_cancels_the_remainder(
    command_scope,
):
    first_id = await _insert_pending_interaction(command_scope, token="parallel-first")
    second_id = await _insert_pending_interaction(
        command_scope, token="parallel-second"
    )
    service = _commands_service(command_scope)

    first = await service.respond_interaction(
        project_id=command_scope["project_id"],
        user_id=command_scope["user_id"],
        interaction_id=first_id,
        answer={"approved": True},
        expected_execution_id="turn-A",
        idempotency_key="parallel-answer-first",
    )
    assert first.command is None
    assert first.waiting_for_interactions is True

    stopped = await service.request_cancel(
        project_id=command_scope["project_id"],
        user_id=command_scope["user_id"],
        session_id=command_scope["session_id"],
        expected_execution_id="turn-A",
        idempotency_key="parallel-stop",
    )
    assert stopped.accepted is True

    with pytest.raises(InteractionResponseConflict):
        await service.respond_interaction(
            project_id=command_scope["project_id"],
            user_id=command_scope["user_id"],
            interaction_id=second_id,
            answer={"approved": True},
            expected_execution_id="turn-A",
            idempotency_key="parallel-answer-second",
        )

    interactions = SessionInteractionsDAO(engine=command_scope["engine"])
    first_row = await interactions.fetch_interaction(
        project_id=command_scope["project_id"], interaction_id=first_id
    )
    second_row = await interactions.fetch_interaction(
        project_id=command_scope["project_id"], interaction_id=second_id
    )
    assert first_row.status == SessionInteractionStatus.responded
    assert second_row.status == SessionInteractionStatus.cancelled
    async with command_scope["engine"].session() as session:
        continuation_count = await session.scalar(
            text(
                "SELECT count(*) FROM session_executions "
                "WHERE project_id = :project_id AND session_id = :session_id "
                "AND parent_execution_id = 'turn-A'"
            ),
            {
                "project_id": command_scope["project_id"],
                "session_id": command_scope["session_id"],
            },
        )
    assert continuation_count == 0


async def test_full_service_parallel_answers_create_one_terminal_continuation(
    command_scope,
):
    first_id = await _insert_pending_interaction(
        command_scope, token="parallel-continue-first"
    )
    second_id = await _insert_pending_interaction(
        command_scope, token="parallel-continue-second"
    )
    service = _commands_service(command_scope)

    first = await service.respond_interaction(
        project_id=command_scope["project_id"],
        user_id=command_scope["user_id"],
        interaction_id=first_id,
        answer={"approved": True},
        expected_execution_id="turn-A",
        idempotency_key="parallel-continue-answer-first",
    )
    assert first.command is None

    second = await service.respond_interaction(
        project_id=command_scope["project_id"],
        user_id=command_scope["user_id"],
        interaction_id=second_id,
        answer={"approved": False},
        expected_execution_id="turn-A",
        idempotency_key="parallel-continue-answer-second",
    )
    assert second.command is not None

    async with command_scope["engine"].session() as session:
        before = (
            await session.execute(
                text(
                    "SELECT execution_id, terminal_outcome FROM session_executions "
                    "WHERE project_id = :project_id AND session_id = :session_id "
                    "AND parent_execution_id = 'turn-A'"
                ),
                {
                    "project_id": command_scope["project_id"],
                    "session_id": command_scope["session_id"],
                },
            )
        ).all()
    assert before == [(second.execution_id, None)]

    assert await service.settle_execution_completed(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        execution_id=second.execution_id,
    )
    async with command_scope["engine"].session() as session:
        outcomes = (
            (
                await session.execute(
                    text(
                        "SELECT terminal_outcome FROM session_executions "
                        "WHERE project_id = :project_id AND session_id = :session_id "
                        "AND parent_execution_id = 'turn-A'"
                    ),
                    {
                        "project_id": command_scope["project_id"],
                        "session_id": command_scope["session_id"],
                    },
                )
            )
            .scalars()
            .all()
        )
    assert outcomes == ["completed"]


async def test_full_service_failure_rolls_back_answer_execution_and_command(
    command_scope,
):
    interaction_id = await _insert_pending_interaction(
        command_scope, token="service-rollback"
    )
    async with command_scope["engine"].session() as session:
        await session.execute(
            text(
                "INSERT INTO session_executions "
                "(project_id, session_id, execution_id, state) "
                "VALUES (:project_id, :session_id, 'turn-A', 'active')"
            ),
            {
                "project_id": command_scope["project_id"],
                "session_id": command_scope["session_id"],
            },
        )
    service = _commands_service(command_scope)
    create_command = service._dao.create_command

    async def fail_after_command_insert(**kwargs):
        await create_command(**kwargs)
        raise RuntimeError("abort transaction")

    service._dao.create_command = fail_after_command_insert

    with pytest.raises(RuntimeError, match="abort transaction"):
        await service.respond_interaction(
            project_id=command_scope["project_id"],
            user_id=command_scope["user_id"],
            interaction_id=interaction_id,
            answer={"approved": True},
            expected_execution_id="turn-A",
            idempotency_key="answer-rollback",
        )

    interaction = await SessionInteractionsDAO(
        engine=command_scope["engine"]
    ).fetch_interaction(
        project_id=command_scope["project_id"], interaction_id=interaction_id
    )
    assert interaction.status == SessionInteractionStatus.pending
    async with command_scope["engine"].session() as session:
        execution = (
            await session.execute(
                text(
                    "SELECT state, terminal_outcome FROM session_executions "
                    "WHERE project_id = :project_id AND session_id = :session_id "
                    "AND execution_id = 'turn-A'"
                ),
                {
                    "project_id": command_scope["project_id"],
                    "session_id": command_scope["session_id"],
                },
            )
        ).one()
        continuation_count = await session.scalar(
            text(
                "SELECT count(*) FROM session_executions "
                "WHERE project_id = :project_id AND session_id = :session_id "
                "AND parent_execution_id = 'turn-A'"
            ),
            {
                "project_id": command_scope["project_id"],
                "session_id": command_scope["session_id"],
            },
        )
        commands = await session.scalar(
            text(
                "SELECT count(*) FROM session_commands "
                "WHERE project_id = :project_id AND session_id = :session_id"
            ),
            {
                "project_id": command_scope["project_id"],
                "session_id": command_scope["session_id"],
            },
        )
    assert execution == ("active", None)
    assert continuation_count == 0
    assert commands == 0


async def test_full_service_concurrent_same_key_same_answer_replays_ids(command_scope):
    interaction_id = await _insert_pending_interaction(
        command_scope, token="service-same"
    )
    service = _commands_service(command_scope)
    request = dict(
        project_id=command_scope["project_id"],
        user_id=command_scope["user_id"],
        interaction_id=interaction_id,
        answer={"approved": True},
        expected_execution_id="turn-A",
        idempotency_key="answer-same",
    )

    first, second = await asyncio.gather(
        service.respond_interaction(**request),
        service.respond_interaction(**request),
    )

    assert first.command.id == second.command.id
    assert first.execution_id == second.execution_id


async def test_full_service_concurrent_same_key_conflicting_answer_is_409_domain(
    command_scope,
):
    interaction_id = await _insert_pending_interaction(
        command_scope, token="service-conflict"
    )
    service = _commands_service(command_scope)
    common = dict(
        project_id=command_scope["project_id"],
        user_id=command_scope["user_id"],
        interaction_id=interaction_id,
        expected_execution_id="turn-A",
        idempotency_key="answer-conflict",
    )

    results = await asyncio.gather(
        service.respond_interaction(answer={"approved": True}, **common),
        service.respond_interaction(answer={"approved": False}, **common),
        return_exceptions=True,
    )

    assert sum(not isinstance(result, Exception) for result in results) == 1
    conflict = next(result for result in results if isinstance(result, Exception))
    assert isinstance(conflict, IdempotencyKeyReused)


async def test_live_continuation_is_a_send_candidate_and_reopens_after_recovery(
    command_scope,
):
    commands = SessionCommandsDAO(engine=command_scope["engine"])
    executions = SessionExecutionsDAO(engine=command_scope["engine"])
    interaction_id = await _insert_pending_interaction(
        command_scope, token="running-blocker"
    )
    async with commands.transaction() as transaction:
        await executions.create_continuation(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            execution_id="continuation-running",
            parent_execution_id="turn-A",
            source_interaction_id=interaction_id,
            transaction=transaction,
        )
        command = await commands.create_command(
            user_id=command_scope["user_id"],
            command=_create(
                command_scope,
                kind=SessionCommandKind.continue_interaction,
                target_turn_id="continuation-running",
                expected_turn_id="turn-A",
                data={
                    "interaction_id": str(interaction_id),
                    "continuation_execution_id": "continuation-running",
                },
                state=SessionCommandState.applied,
                outcome=SessionCommandOutcome.started,
                settled_at=datetime.now(timezone.utc),
            ),
            transaction=transaction,
        )
        await executions.set_state(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            execution_id="continuation-running",
            state=SessionExecutionState.running,
            transaction=transaction,
        )

    # A `running` continuation row now REACHES the service, which decides between the two live
    # shapes `running` covers. The DAO deliberately does not: the discriminator is the Redis
    # `running` lock, which only the service reads.
    #
    #   * PARKED on its own approval — no Redis `running` lock. A Send is a steer and is
    #     allowed. This is review finding N2 and it stays.
    #   * EXECUTING inside a tool call — the lock names this execution. A Send starts a second
    #     turn, the runner supersedes, the warm sandbox is destroyed mid-call and the tool the
    #     user had just approved returns "Command aborted" (increment-6 browser pass, round 8,
    #     session 9d40cfcc-6485-4250-8d2e-17f1f12f55f4). It is refused.
    #
    # Both are covered by the two `resume_recoverable_continuation` tests below.
    blocker = await commands.fetch_resumable_continuation(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
    )
    assert blocker is not None and blocker.id == command.id
    # Being a Send candidate is not the same as being retargetable: only a recovered execution
    # reopens.
    assert (
        await commands.reopen_continuation(
            project_id=command_scope["project_id"],
            command_id=command.id,
            target_turn_id="continuation-running",
            replacement_turn_id="continuation-retry",
        )
        is None
    )

    await executions.set_state(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        execution_id="continuation-running",
        state=SessionExecutionState.recoverable,
        expected_states=[SessionExecutionState.running],
    )
    blocker = await commands.fetch_resumable_continuation(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
    )
    assert blocker is not None and blocker.id == command.id
    async with commands.transaction() as transaction:
        await executions.create_continuation(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            execution_id="continuation-retry",
            parent_execution_id="continuation-running",
            source_interaction_id=None,
            transaction=transaction,
        )
    reopened = await commands.reopen_continuation(
        project_id=command_scope["project_id"],
        command_id=command.id,
        target_turn_id="continuation-running",
        replacement_turn_id="continuation-retry",
    )
    assert reopened is not None
    assert reopened.state == SessionCommandState.pending
    assert reopened.claimed_by is None
    assert reopened.target_turn_id == "continuation-retry"


async def _park_continuation_on_its_own_gate(command_scope, *, token: str) -> None:
    """The shape a continuation leaves when it raises its OWN approval and stops on the user."""
    async with command_scope["engine"].session() as session:
        await session.execute(
            text(
                "INSERT INTO session_interactions "
                "(project_id, id, session_id, turn_id, token, kind, status) "
                "VALUES (:project_id, :id, :session_id, 'continuation-live', :token, "
                "'user_approval', 'pending')"
            ),
            {
                "project_id": command_scope["project_id"],
                "id": uuid.uuid4(),
                "session_id": command_scope["session_id"],
                "token": token,
            },
        )


async def _seed_live_continuation(command_scope, *, token: str) -> None:
    commands = SessionCommandsDAO(engine=command_scope["engine"])
    executions = SessionExecutionsDAO(engine=command_scope["engine"])
    interaction_id = await _insert_pending_interaction(command_scope, token=token)
    async with commands.transaction() as transaction:
        await executions.create_continuation(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            execution_id="continuation-live",
            parent_execution_id="turn-A",
            source_interaction_id=interaction_id,
            transaction=transaction,
        )
        await commands.create_command(
            user_id=command_scope["user_id"],
            command=_create(
                command_scope,
                kind=SessionCommandKind.continue_interaction,
                target_turn_id="continuation-live",
                expected_turn_id="turn-A",
                data={
                    "interaction_id": str(interaction_id),
                    "continuation_execution_id": "continuation-live",
                },
                state=SessionCommandState.applied,
                outcome=SessionCommandOutcome.started,
                settled_at=datetime.now(timezone.utc),
            ),
            transaction=transaction,
        )
        await executions.set_state(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            execution_id="continuation-live",
            state=SessionExecutionState.running,
            transaction=transaction,
        )


async def test_executing_continuation_refuses_a_competing_send(
    command_scope, monkeypatch
):
    """The continuation is inside a tool call: Send must be refused, not superseded.

    Its execution holds no pending gate of its own, which is exactly the state the runner was
    in when a released message tore down the warm sandbox and turned the approved call into
    "Command aborted".
    """
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    await _seed_live_continuation(command_scope, token="live-executing")
    service = _commands_service(command_scope)

    assert (
        await service.resume_recoverable_continuation(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
        )
        is True
    )


async def test_parked_continuation_still_accepts_a_send(command_scope, monkeypatch):
    """The continuation raised its own approval gate: a Send is a steer and stays allowed.

    The park writes a pending interaction row against the continuation's own execution, so the
    same `running` row in Postgres must not be read as ownership. This is review finding N2.
    """
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    await _seed_live_continuation(command_scope, token="live-parked")
    await _park_continuation_on_its_own_gate(command_scope, token="live-parked-gate")
    service = _commands_service(command_scope)

    assert (
        await service.resume_recoverable_continuation(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
        )
        is False
    )


async def test_stop_and_answer_have_one_postgres_serialized_winner(command_scope):
    commands = SessionCommandsDAO(engine=command_scope["engine"])
    executions = SessionExecutionsDAO(engine=command_scope["engine"])
    interactions = SessionInteractionsDAO(engine=command_scope["engine"])
    interaction_id = await _insert_pending_interaction(command_scope, token="race")

    async def stop():
        async with commands.transaction() as transaction:
            source = await executions.lock_for_control(
                project_id=command_scope["project_id"],
                session_id=command_scope["session_id"],
                execution_id="turn-A",
                transaction=transaction,
            )
            if source.terminal_outcome is not None:
                return False
            await executions.set_state(
                project_id=command_scope["project_id"],
                session_id=command_scope["session_id"],
                execution_id="turn-A",
                state=SessionExecutionState.stopping,
                transaction=transaction,
            )
            await interactions.cancel_session_pending(
                project_id=command_scope["project_id"],
                session_id=command_scope["session_id"],
                only_turn_id="turn-A",
                transaction=transaction,
            )
            return True

    async def answer():
        async with commands.transaction() as transaction:
            source = await executions.lock_for_control(
                project_id=command_scope["project_id"],
                session_id=command_scope["session_id"],
                execution_id="turn-A",
                transaction=transaction,
            )
            interaction = await interactions.fetch_interaction(
                project_id=command_scope["project_id"],
                interaction_id=interaction_id,
                transaction=transaction,
                for_update=True,
            )
            if (
                source.terminal_outcome is not None
                or source.state == SessionExecutionState.stopping
                or interaction.status != SessionInteractionStatus.pending
            ):
                return False
            await interactions.transition_interaction(
                transition=SessionInteractionTransition(
                    project_id=command_scope["project_id"],
                    session_id=command_scope["session_id"],
                    token="race",
                    status=SessionInteractionStatus.responded,
                    resolution={"approved": True},
                ),
                transaction=transaction,
            )
            await executions.settle(
                project_id=command_scope["project_id"],
                session_id=command_scope["session_id"],
                execution_id="turn-A",
                terminal_outcome="continued",
                settled_by="interaction_response",
                transaction=transaction,
            )
            return True

    winners = await asyncio.gather(stop(), answer())
    assert sum(winners) == 1

    interaction = await interactions.fetch_interaction(
        project_id=command_scope["project_id"], interaction_id=interaction_id
    )
    assert interaction.status in (
        SessionInteractionStatus.cancelled,
        SessionInteractionStatus.responded,
    )


async def test_continuation_transaction_rolls_back_the_answer_on_failure(command_scope):
    commands = SessionCommandsDAO(engine=command_scope["engine"])
    executions = SessionExecutionsDAO(engine=command_scope["engine"])
    interactions = SessionInteractionsDAO(engine=command_scope["engine"])
    interaction_id = await _insert_pending_interaction(command_scope, token="rollback")

    with pytest.raises(RuntimeError, match="abort transaction"):
        async with commands.transaction() as transaction:
            await executions.lock_for_control(
                project_id=command_scope["project_id"],
                session_id=command_scope["session_id"],
                execution_id="turn-A",
                transaction=transaction,
            )
            await interactions.transition_interaction(
                transition=SessionInteractionTransition(
                    project_id=command_scope["project_id"],
                    session_id=command_scope["session_id"],
                    token="rollback",
                    status=SessionInteractionStatus.responded,
                    resolution={"approved": True},
                ),
                transaction=transaction,
            )
            await executions.create_continuation(
                project_id=command_scope["project_id"],
                session_id=command_scope["session_id"],
                execution_id="continuation-rollback",
                parent_execution_id="turn-A",
                source_interaction_id=interaction_id,
                transaction=transaction,
            )
            raise RuntimeError("abort transaction")

    interaction = await interactions.fetch_interaction(
        project_id=command_scope["project_id"], interaction_id=interaction_id
    )
    assert interaction.status == SessionInteractionStatus.pending
    async with command_scope["engine"].session() as session:
        count = await session.scalar(
            text(
                "SELECT count(*) FROM session_executions "
                "WHERE project_id = :project_id AND execution_id = 'continuation-rollback'"
            ),
            {"project_id": command_scope["project_id"]},
        )
    assert count == 0


async def test_terminal_core_facts_commit_in_one_transaction(command_scope):
    commands = SessionCommandsDAO(engine=command_scope["engine"])
    executions = SessionExecutionsDAO(engine=command_scope["engine"])
    streams = SessionStreamsDAO(engine=command_scope["engine"])
    interactions = SessionInteractionsDAO(engine=command_scope["engine"])
    command = await commands.create_command(
        user_id=command_scope["user_id"],
        command=_create(command_scope),
        stopping_turn_id="turn-A",
    )
    await commands.record_delivery_attempt(
        project_id=command_scope["project_id"],
        command_id=command.id,
        now=datetime.now(timezone.utc),
        max_deliveries=3,
    )
    await commands.claim_for_delivery(
        project_id=command_scope["project_id"],
        command_id=command.id,
        replica_id="runner-1",
        lease_seconds=90,
    )
    interaction_id = uuid.uuid4()
    async with command_scope["engine"].session() as session:
        await session.execute(
            text(
                "UPDATE session_streams SET flags = "
                '\'{"is_alive": true, "is_running": true, '
                '"is_attached": true}\'::jsonb '
                "WHERE project_id = :project_id AND session_id = :session_id"
            ),
            {
                "project_id": command_scope["project_id"],
                "session_id": command_scope["session_id"],
            },
        )
        await session.execute(
            text(
                "INSERT INTO session_interactions "
                "(project_id, id, session_id, turn_id, token, kind, status) "
                "VALUES (:project_id, :id, :session_id, 'turn-A', "
                "'token-A', 'user_approval', 'pending')"
            ),
            {
                "project_id": command_scope["project_id"],
                "id": interaction_id,
                "session_id": command_scope["session_id"],
            },
        )

    transition = SessionCommandSettle(
        project_id=command_scope["project_id"],
        command_id=command.id,
        state=SessionCommandState.applied,
        outcome=SessionCommandOutcome.stopped,
        expected_states=[SessionCommandState.claimed],
        replica_id="runner-1",
    )
    async with commands.transaction() as transaction:
        settled = await commands.settle_command(
            settle=transition,
            transaction=transaction,
        )
        execution = await executions.settle(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            execution_id="turn-A",
            terminal_outcome="stopped",
            settled_by="runner",
            transaction=transaction,
        )
        await streams.settle_command(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            turn_id="turn-A",
            mirror_stopped=True,
            transaction=transaction,
        )
        await interactions.cancel_session_pending(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            only_turn_id="turn-A",
            transaction=transaction,
        )

    assert settled is not None
    assert execution.won is True
    async with command_scope["engine"].session() as session:
        row = (
            await session.execute(
                text(
                    "SELECT c.state, c.outcome, s.stopping_turn_id, "
                    "s.flags->>'is_running', s.flags->>'is_attached', i.status, "
                    "e.terminal_outcome "
                    "FROM session_commands c "
                    "JOIN session_streams s ON s.project_id = c.project_id "
                    "AND s.session_id = c.session_id "
                    "JOIN session_interactions i ON i.project_id = c.project_id "
                    "AND i.session_id = c.session_id "
                    "JOIN session_executions e ON e.project_id = c.project_id "
                    "AND e.session_id = c.session_id "
                    "AND e.execution_id = c.target_turn_id "
                    "WHERE c.project_id = :project_id AND c.id = :command_id"
                ),
                {
                    "project_id": command_scope["project_id"],
                    "command_id": command.id,
                },
            )
        ).one()
    assert tuple(row) == (
        "applied",
        "stopped",
        None,
        "false",
        "true",
        "cancelled",
        "stopped",
    )


async def test_execution_conflict_rolls_back_the_command_transition(command_scope):
    commands = SessionCommandsDAO(engine=command_scope["engine"])
    executions = SessionExecutionsDAO(engine=command_scope["engine"])
    streams = SessionStreamsDAO(engine=command_scope["engine"])
    interactions = SessionInteractionsDAO(engine=command_scope["engine"])
    command = await commands.create_command(
        user_id=command_scope["user_id"],
        command=_create(command_scope),
        stopping_turn_id="turn-A",
    )
    await commands.record_delivery_attempt(
        project_id=command_scope["project_id"],
        command_id=command.id,
        now=datetime.now(timezone.utc),
        max_deliveries=3,
    )
    await commands.claim_for_delivery(
        project_id=command_scope["project_id"],
        command_id=command.id,
        replica_id="runner-1",
        lease_seconds=90,
    )
    await executions.settle(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        execution_id="turn-A",
        terminal_outcome="lost",
        settled_by="watchdog",
    )

    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=SessionStreamsService(
            streams_dao=streams,
            lock_engine=None,
        ),
        interactions_service=SessionInteractionsService(
            interactions_dao=interactions,
        ),
        lock_engine=None,
        delivery=None,
        executions_dao=executions,
    )
    settled = await service.settle(
        command_id=command.id,
        project_id=command_scope["project_id"],
        replica_id="runner-1",
        expected_states=[SessionCommandState.claimed],
        state=SessionCommandState.applied,
        outcome=SessionCommandOutcome.stopped,
        execution_id="turn-A",
    )

    assert settled is None
    stored = await commands.fetch_command(command_id=command.id)
    assert stored is not None
    assert stored.state == SessionCommandState.claimed
    assert stored.outcome is None
