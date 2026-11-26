"""A deleted private session leaves a tombstone (`session_trace_tombstones`), so its id
stays hidden from everyone but its former owner while tracing retention keeps its records.

- The delete writes the tombstone in the statement that deletes the row (one statement);
  a project session leaves none.
- The policy read of a session with no row reads the tombstone in the same one statement.
"""

from uuid import UUID

import pytest
from uuid_utils.compat import uuid7

from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.sharing.dao import SharingDAO
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.statements import count_statements

pytestmark = pytest.mark.integration


@pytest.fixture
async def seeded():
    organization = await seed_organization(members={"alice": "editor"})
    yield organization
    await execute(
        "DELETE FROM session_trace_tombstones WHERE project_id = :p",
        {"p": organization.project_ids[0]},
    )
    await delete_seeded_organization(organization)


async def _session(project_id: UUID, owner, visibility: str) -> str:
    stream_id = uuid7()
    session_id = f"tombstone-{stream_id.hex}"
    await execute(
        "INSERT INTO session_streams (project_id, id, session_id, visibility, "
        "owner_user_id) VALUES (:p, :id, :s, :v, :o)",
        {
            "p": project_id,
            "id": stream_id,
            "s": session_id,
            "v": visibility,
            "o": owner,
        },
    )
    return session_id


async def _tombstone(project_id: UUID, session_id: str):
    async with get_transactions_engine().session() as session:
        from sqlalchemy import text  # noqa: PLC0415

        return (
            await session.execute(
                text(
                    "SELECT owner_user_id FROM session_trace_tombstones "
                    "WHERE project_id = :p AND session_id = :s"
                ),
                {"p": project_id, "s": session_id},
            )
        ).first()


@pytest.mark.parametrize("visibility", ["private", "project"])
async def test_the_delete_writes_the_tombstone_of_a_private_session(seeded, visibility):
    project_id = seeded.project_ids[0]
    alice = seeded.user_ids["alice"]
    owner = alice if visibility == "private" else None
    session_id = await _session(project_id, owner, visibility)
    dao = SessionStreamsDAO(engine=get_transactions_engine())

    with count_statements(get_transactions_engine()) as statements:
        deleted = await dao.hard_delete_by_session_id(
            project_id=project_id, session_id=session_id
        )

    assert deleted is True
    assert len(statements) == 2  # the per-id lock, then the delete with its tombstone
    row = await _tombstone(project_id, session_id)
    if visibility == "private":
        assert row is not None and row.owner_user_id == alice
    else:
        assert row is None


async def test_the_missing_session_read_answers_the_tombstone_in_one_statement(seeded):
    project_id = seeded.project_ids[0]
    alice = seeded.user_ids["alice"]
    session_id = await _session(project_id, alice, "private")
    await SessionStreamsDAO(engine=get_transactions_engine()).hard_delete_by_session_id(
        project_id=project_id, session_id=session_id
    )
    sharing = SharingDAO(engine=get_transactions_engine())

    with count_statements(get_transactions_engine()) as statements:
        state, tombstone = await sharing.fetch_session_policy_or_tombstone(
            project_id=project_id, session_id=session_id
        )
        none_state, none_tombstone = await sharing.fetch_session_policy_or_tombstone(
            project_id=project_id, session_id="tombstone-never-existed"
        )

    assert len(statements) == 2  # one per read
    assert state is None and tombstone is not None and tombstone.owner_user_id == alice
    assert none_state is None and none_tombstone is None


async def test_a_live_row_reads_as_before(seeded):
    project_id = seeded.project_ids[0]
    alice = seeded.user_ids["alice"]
    session_id = await _session(project_id, alice, "private")
    sharing = SharingDAO(engine=get_transactions_engine())

    state, tombstone = await sharing.fetch_session_policy_or_tombstone(
        project_id=project_id, session_id=session_id
    )
    plain = await sharing.fetch_session_policy(
        project_id=project_id, session_id=session_id
    )

    assert tombstone is None
    assert state == plain


async def test_no_session_is_created_over_a_tombstone(seeded):
    """The create is one statement that writes nothing over a tombstone: a heartbeat, a
    start or a send that names a deleted private session's id cannot bring it back."""
    from oss.src.core.sessions.streams.dtos import SessionStreamCreate  # noqa: PLC0415
    from oss.src.core.sessions.streams.types import SessionIdTombstoned  # noqa: PLC0415
    from oss.src.core.sharing.dtos import OWNERLESS_PROJECT_POLICY  # noqa: PLC0415

    project_id = seeded.project_ids[0]
    alice = seeded.user_ids["alice"]
    session_id = await _session(project_id, alice, "private")
    dao = SessionStreamsDAO(engine=get_transactions_engine())
    await dao.hard_delete_by_session_id(project_id=project_id, session_id=session_id)

    with count_statements(get_transactions_engine()) as statements:
        with pytest.raises(SessionIdTombstoned):
            await dao.create(
                project_id=project_id,
                user_id=None,
                stream=SessionStreamCreate(
                    session_id=session_id, access=OWNERLESS_PROJECT_POLICY
                ),
            )
    assert len(statements) == 2  # the per-id lock, then the guarded insert
    assert (
        await dao.get_by_session_id(project_id=project_id, session_id=session_id)
        is None
    )

    fresh = await dao.create(
        project_id=project_id,
        user_id=None,
        stream=SessionStreamCreate(
            session_id=f"tombstone-fresh-{uuid7().hex}", access=OWNERLESS_PROJECT_POLICY
        ),
    )
    assert fresh.id is not None and fresh.created_at is not None


async def test_a_create_racing_a_delete_reads_its_tombstone(seeded):
    """Alice's delete holds the per-id lock and has not committed yet when a heartbeat
    creates the same id. The create waits for the lock, then reads the tombstone the
    delete committed: no row comes back over it."""
    import asyncio  # noqa: PLC0415

    from sqlalchemy import text  # noqa: PLC0415

    from oss.src.core.sessions.streams.dtos import SessionStreamCreate  # noqa: PLC0415
    from oss.src.core.sessions.streams.types import SessionIdTombstoned  # noqa: PLC0415
    from oss.src.core.sharing.dtos import OWNERLESS_PROJECT_POLICY  # noqa: PLC0415
    from oss.src.dbs.postgres.sessions.streams.dao import (  # noqa: PLC0415
        _HARD_DELETE_WITH_TOMBSTONE_SQL,
        _SESSION_ID_LOCK_SQL,
    )

    project_id = seeded.project_ids[0]
    alice = seeded.user_ids["alice"]
    session_id = await _session(project_id, alice, "private")
    await execute(
        "UPDATE session_streams SET deleted_at = now() "
        "WHERE project_id = :p AND session_id = :s",
        {"p": project_id, "s": session_id},
    )
    engine = get_transactions_engine()
    dao = SessionStreamsDAO(engine=engine)

    async with engine.session() as deleting:
        await deleting.execute(
            text(_SESSION_ID_LOCK_SQL), {"lock_key": f"{project_id}:{session_id}"}
        )
        await deleting.execute(
            text(_HARD_DELETE_WITH_TOMBSTONE_SQL),
            {"project_id": project_id, "session_id": session_id},
        )
        create = asyncio.create_task(
            dao.create(
                project_id=project_id,
                user_id=None,
                stream=SessionStreamCreate(
                    session_id=session_id, access=OWNERLESS_PROJECT_POLICY
                ),
            )
        )
        await asyncio.sleep(0.5)
        assert not create.done()  # waiting for the delete's lock
        await deleting.commit()

    with pytest.raises(SessionIdTombstoned):
        await create
    assert (
        await dao.get_by_session_id(project_id=project_id, session_id=session_id)
        is None
    )


async def test_the_zombie_cleanup_keeps_a_row_another_turn_adopted(seeded):
    """A displaced turn's beat inserted a row; before its cleanup runs, a new turn adopts
    the row. The cleanup deletes only the row it inserted, while it still holds the
    zombie's turn: the adopted row stays."""
    project_id = seeded.project_ids[0]
    stream_id = uuid7()
    session_id = f"tombstone-zombie-{stream_id.hex}"
    await execute(
        "INSERT INTO session_streams (project_id, id, session_id, visibility, turn_id) "
        "VALUES (:p, :id, :s, 'project', 'turn-zombie')",
        {"p": project_id, "id": stream_id, "s": session_id},
    )
    await execute(
        "UPDATE session_streams SET turn_id = 'turn-live' "
        "WHERE project_id = :p AND session_id = :s",
        {"p": project_id, "s": session_id},
    )
    dao = SessionStreamsDAO(engine=get_transactions_engine())

    kept = await dao.delete_row_if_unchanged(
        project_id=project_id,
        session_id=session_id,
        stream_id=stream_id,
        turn_id="turn-zombie",
    )
    assert kept is False
    assert await dao.get_by_session_id(project_id=project_id, session_id=session_id)

    removed = await dao.delete_row_if_unchanged(
        project_id=project_id,
        session_id=session_id,
        stream_id=stream_id,
        turn_id="turn-live",
    )
    assert removed is True
