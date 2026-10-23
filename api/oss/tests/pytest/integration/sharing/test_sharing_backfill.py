"""`oss000000049`: the one-time backfill, on temp-table shadows of the tables it touches.

The backfill walks whole tables. Running it on the shared tables of the stack, even in a
rolled-back transaction, would lock rows that parallel tests write. So each test copies
the shape of the six tables into temp tables (`pg_temp` is searched first, so the
revision's unqualified names hit the copies), seeds rows there, runs the revision's own
`_backfill_agents` and `_backfill_sessions`, and rolls back. The copies have no foreign
keys, so no organization is seeded. The stack database must be at `oss000000048` or
later.
"""

import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import load_revision_module


pytestmark = pytest.mark.integration

REVISION = "oss000000049_backfill_agent_session_sharing.py"

_SHADOWED = (
    "workflow_artifacts",
    "workflow_revisions",
    "agent_access",
    "session_streams",
    "session_turns",
    "channel_threads",
)

_T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


@asynccontextmanager
async def shadowed():
    engine = get_transactions_engine()
    inner = getattr(engine, "_engine", engine)
    async with inner.connect() as connection:
        transaction = await connection.begin()
        try:
            for table in _SHADOWED:
                # INCLUDING ALL: the primary key (for ON CONFLICT) and the checks.
                await connection.execute(
                    text(
                        f"CREATE TEMP TABLE {table} "
                        f"(LIKE public.{table} INCLUDING ALL) ON COMMIT DROP"
                    )
                )
            yield connection
        finally:
            await transaction.rollback()


async def _backfill(connection, *, batch_size: Optional[int] = None):
    module = load_revision_module(REVISION)
    if batch_size is not None:
        module.BATCH_SIZE = batch_size

    def _run(sync):
        return module._backfill_agents(sync), module._backfill_sessions(sync)

    return await connection.run_sync(_run)


async def _artifact(connection, *, project_id, created_by_id, flags, deleted=False):
    artifact_id, variant_id = uuid4(), uuid4()
    slug = f"wf-{artifact_id.hex[:8]}"
    await connection.execute(
        text(
            "INSERT INTO workflow_artifacts (project_id, id, slug, created_by_id, "
            "deleted_at) VALUES (:p, :a, :s, :u, CASE WHEN :deleted THEN now() END)"
        ),
        {
            "p": project_id,
            "a": artifact_id,
            "s": slug,
            "u": created_by_id,
            "deleted": deleted,
        },
    )
    for index, revision_flags in enumerate(flags):
        await connection.execute(
            text(
                "INSERT INTO workflow_revisions (project_id, artifact_id, variant_id, "
                "id, slug, author, flags) VALUES (:p, :a, :v, :r, :s, :p, "
                "CAST(:flags AS jsonb))"
            ),
            {
                "p": project_id,
                "a": artifact_id,
                "v": variant_id,
                "r": uuid4(),
                "s": f"{slug}.r{index}",
                "flags": None if revision_flags is None else json.dumps(revision_flags),
            },
        )
    return artifact_id


async def _stream(
    connection,
    *,
    project_id,
    created_by_id=None,
    visibility=None,
    owner_user_id=None,
    stream_id=None,
):
    stream_id = stream_id or uuid4()
    session_id = f"s-{uuid4().hex}"
    await connection.execute(
        text(
            "INSERT INTO session_streams (project_id, id, session_id, created_by_id, "
            "visibility, owner_user_id) VALUES (:p, :id, :s, :u, :v, :o)"
        ),
        {
            "p": project_id,
            "id": stream_id,
            "s": session_id,
            "u": created_by_id,
            "v": visibility,
            "o": owner_user_id,
        },
    )
    return stream_id, session_id


async def _turn(
    connection,
    *,
    project_id,
    stream,
    turn_index=0,
    principal_kind=None,
    principal_id=None,
    sender_user_id=None,
    origin=None,
    created_by_id=None,
):
    stream_id, session_id = stream
    await connection.execute(
        text(
            "INSERT INTO session_turns (project_id, id, session_id, stream_id, "
            "turn_index, harness_kind, principal_kind, principal_id, sender_user_id, "
            "origin, created_by_id, created_at) VALUES (:p, :id, :s, :st, :i, 'pi', "
            ":pk, :pid, :sender, :origin, :u, :at)"
        ),
        {
            "p": project_id,
            "id": uuid4(),
            "s": session_id,
            "st": stream_id,
            "i": turn_index,
            "pk": principal_kind,
            "pid": principal_id,
            "sender": sender_user_id,
            "origin": origin,
            "u": created_by_id,
            "at": _T0 + timedelta(minutes=turn_index),
        },
    )


async def _policy(connection, stream_id: UUID):
    row = (
        await connection.execute(
            text(
                "SELECT visibility, owner_user_id FROM session_streams WHERE id = :id"
            ),
            {"id": stream_id},
        )
    ).first()
    return (row.visibility, row.owner_user_id)


async def _agent_rows(connection):
    rows = (
        await connection.execute(
            text(
                "SELECT artifact_id, visibility, owner_user_id, created_by_id "
                "FROM agent_access"
            )
        )
    ).all()
    return {row.artifact_id: row for row in rows}


async def test_old_and_new_rows_together():
    async with shadowed() as connection:
        project_id, carol = uuid4(), uuid4()
        agent = await _artifact(
            connection,
            project_id=project_id,
            created_by_id=carol,
            flags=[{"is_agent": True}],
        )
        archived_agent = await _artifact(
            connection,
            project_id=project_id,
            created_by_id=carol,
            flags=[{"is_agent": True, "is_chat": False}],
            deleted=True,
        )
        legacy = await _stream(connection, project_id=project_id, created_by_id=carol)
        new = await _stream(
            connection,
            project_id=project_id,
            created_by_id=uuid4(),
            visibility="project",
            owner_user_id=None,
        )

        assert await _backfill(connection) == (2, 1)
        assert await _policy(connection, legacy[0]) == ("project", carol)
        assert await _policy(connection, new[0]) == ("project", None)
        agents = await _agent_rows(connection)
        assert set(agents) == {agent, archived_agent}
        for row in agents.values():
            assert (row.visibility, row.owner_user_id, row.created_by_id) == (
                "project",
                carol,
                carol,
            )

        # A second run changes nothing.
        assert await _backfill(connection) == (0, 0)
        assert await _policy(connection, legacy[0]) == ("project", carol)
        assert await _policy(connection, new[0]) == ("project", None)


async def test_m2_turn_attribution_decides_owner():
    async with shadowed() as connection:
        project_id, alice, bob, key_id, installation_id = (
            uuid4(),
            uuid4(),
            uuid4(),
            uuid4(),
            uuid4(),
        )
        cases = [
            # (first turn fields, expected owner)
            (dict(principal_kind="human", principal_id=alice, sender_user_id=alice, origin="web"), alice),
            (dict(principal_kind="api_key", principal_id=key_id, origin="api"), None),
            (dict(principal_kind="api_key", principal_id=key_id, sender_user_id=alice, origin="api"), alice),
            (dict(principal_kind="human", principal_id=bob, origin="schedule"), bob),
            (dict(principal_kind="human", principal_id=bob, origin="subscription"), None),
            (dict(principal_kind="installation", principal_id=installation_id, sender_user_id=alice, origin="installation"), None),
            (dict(principal_kind="human", principal_id=bob, sender_user_id=bob, origin="child"), None),
            (dict(principal_kind="human", principal_id=bob, origin="evaluation"), None),
        ]  # fmt: skip
        streams = []
        for fields, expected in cases:
            # The stream creator differs from every expected owner, so a creator
            # fallback would show.
            stream = await _stream(
                connection, project_id=project_id, created_by_id=uuid4()
            )
            await _turn(
                connection,
                project_id=project_id,
                stream=stream,
                created_by_id=uuid4(),
                **fields,
            )
            # A later turn by someone else never decides.
            await _turn(
                connection,
                project_id=project_id,
                stream=stream,
                turn_index=1,
                principal_kind="human",
                principal_id=uuid4(),
                sender_user_id=uuid4(),
                origin="web",
            )
            streams.append((stream, expected))

        _, sessions = await _backfill(connection)
        assert sessions == len(cases)
        for (stream_id, _), expected in streams:
            assert await _policy(connection, stream_id) == ("project", expected)


async def test_pre_m2_falls_back_to_creator():
    async with shadowed() as connection:
        project_id, stream_creator, turn_creator = uuid4(), uuid4(), uuid4()

        by_stream = await _stream(
            connection, project_id=project_id, created_by_id=stream_creator
        )
        await _turn(
            connection,
            project_id=project_id,
            stream=by_stream,
            created_by_id=turn_creator,
        )
        by_turn = await _stream(connection, project_id=project_id, created_by_id=None)
        await _turn(
            connection,
            project_id=project_id,
            stream=by_turn,
            created_by_id=turn_creator,
        )
        no_turn = await _stream(
            connection, project_id=project_id, created_by_id=stream_creator
        )
        nobody = await _stream(connection, project_id=project_id, created_by_id=None)
        await _turn(connection, project_id=project_id, stream=nobody)

        await _backfill(connection)
        assert await _policy(connection, by_stream[0]) == ("project", stream_creator)
        assert await _policy(connection, by_turn[0]) == ("project", turn_creator)
        assert await _policy(connection, no_turn[0]) == ("project", stream_creator)
        assert await _policy(connection, nobody[0]) == ("project", None)


async def test_channel_sessions_stay_ownerless():
    async with shadowed() as connection:
        project_id, alice = uuid4(), uuid4()
        stream = await _stream(connection, project_id=project_id, created_by_id=alice)
        await _turn(
            connection,
            project_id=project_id,
            stream=stream,
            principal_kind="human",
            principal_id=alice,
            sender_user_id=alice,
            origin="web",
        )
        await connection.execute(
            text(
                "INSERT INTO channel_threads (project_id, id, space_id, agent_id, "
                "session_id) VALUES (:p, :id, :space, :agent, :s)"
            ),
            {
                "p": project_id,
                "id": uuid4(),
                "space": uuid4(),
                "agent": uuid4(),
                "s": stream[1],
            },
        )

        await _backfill(connection)
        assert await _policy(connection, stream[0]) == ("project", None)


async def test_prompts_and_evaluators_no_row():
    async with shadowed() as connection:
        project_id, alice = uuid4(), uuid4()
        await _artifact(
            connection,
            project_id=project_id,
            created_by_id=alice,
            flags=[{"is_evaluator": True}, {"is_agent": False}],
        )
        await _artifact(
            connection, project_id=project_id, created_by_id=alice, flags=[None]
        )
        await _artifact(
            connection, project_id=project_id, created_by_id=alice, flags=[]
        )
        await _artifact(
            connection,
            project_id=project_id,
            created_by_id=None,
            flags=[{"is_agent": True}],
        )

        agents, _ = await _backfill(connection)
        assert agents == 0
        assert await _agent_rows(connection) == {}


async def test_null_sender_is_kept_not_filled():
    async with shadowed() as connection:
        project_id, alice = uuid4(), uuid4()
        stream = await _stream(connection, project_id=project_id, created_by_id=alice)
        await _turn(
            connection,
            project_id=project_id,
            stream=stream,
            principal_kind="api_key",
            principal_id=uuid4(),
            sender_user_id=None,
            origin="api",
            created_by_id=alice,
        )

        await _backfill(connection)
        assert await _policy(connection, stream[0]) == ("project", None)


async def test_batches_cover_more_than_one_batch():
    async with shadowed() as connection:
        creator = uuid4()
        streams = []
        for project_id in (uuid4(), uuid4()):
            for _ in range(3 if not streams else 2):
                streams.append(
                    await _stream(
                        connection, project_id=project_id, created_by_id=creator
                    )
                )
        # A done row inside the walk: the walk passes it and leaves it alone.
        done = await _stream(
            connection,
            project_id=uuid4(),
            visibility="private",
            owner_user_id=uuid4(),
        )

        _, sessions = await _backfill(connection, batch_size=2)
        assert sessions == 5
        for stream_id, _ in streams:
            assert await _policy(connection, stream_id) == ("project", creator)
        assert (await _policy(connection, done[0]))[0] == "private"
