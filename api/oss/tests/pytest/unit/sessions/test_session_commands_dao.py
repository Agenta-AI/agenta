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
from oss.src.dbs.postgres.sessions.commands.dao import SessionCommandsDAO
from oss.src.dbs.postgres.sessions.executions.dao import SessionExecutionsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
import oss.src.models.db_models  # noqa: F401


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
        command=_create(command_scope, created_at=now - timedelta(minutes=5)),
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
