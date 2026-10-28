"""The shared-session guard of a person's own credential (M7, design D6), on the real
database: one transaction locks the session row, refuses a shared session, and sets the
sticky mark; sharing refuses a marked session under the same lock.

Spec: openspec/changes/personal-credentials-bindings/specs/personal-credential-sessions.
"""

import asyncio
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

import oss.src.models.db_models  # noqa: F401  (the ORM tables the DAOs join)
from oss.src.core.sharing.dtos import (
    AccessPolicy,
    SessionGrantInput,
    SessionRole,
    SessionSharingChange,
    Visibility,
)
from oss.src.core.sharing.types import SessionUsedPersonalAccounts
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.sharing.dao import SharingDAO
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    fetch_all,
    seed_organization,
)

pytestmark = pytest.mark.integration


@asynccontextmanager
async def seeded(*labels: str):
    org = await seed_organization(members={label: "editor" for label in labels})
    try:
        yield org
    finally:
        await delete_seeded_organization(org)


def _dao() -> SharingDAO:
    return SharingDAO(engine=get_transactions_engine())


async def _session(project_id: UUID, *, visibility: str, owner: UUID):
    stream_id, session_id = uuid4(), f"s-{uuid4().hex}"
    await execute(
        "INSERT INTO session_streams (project_id, id, session_id, visibility, "
        "owner_user_id, created_by_id) VALUES (:p, :id, :s, :v, :o, :o)",
        {
            "p": project_id,
            "id": stream_id,
            "s": session_id,
            "v": visibility,
            "o": owner,
        },
    )
    return stream_id, session_id


async def _mark(project_id: UUID, session_id: str):
    rows = await fetch_all(
        "SELECT personal_credentials_used_at FROM session_streams "
        "WHERE project_id = :p AND session_id = :s",
        {"p": project_id, "s": session_id},
    )
    return rows[0][0]


def _invite(user_id: UUID) -> SessionSharingChange:
    return SessionSharingChange(
        upsert_grants=[SessionGrantInput(user_id=user_id, role=SessionRole.PARTICIPANT)]
    )


async def test_a_private_session_is_marked_on_first_personal_use():
    async with seeded("alice") as org:
        project_id, alice = org.project_ids[0], org.user_ids["alice"]
        _, session_id = await _session(project_id, visibility="private", owner=alice)

        assert await _dao().guard_personal_use(
            project_id=project_id, session_id=session_id
        )
        first = await _mark(project_id, session_id)
        assert first is not None
        # The mark never moves.
        assert await _dao().guard_personal_use(
            project_id=project_id, session_id=session_id
        )
        assert await _mark(project_id, session_id) == first


async def test_shared_sessions_refuse_and_stay_unmarked():
    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        _, project_visible = await _session(
            project_id, visibility="project", owner=alice
        )
        stream_id, invited = await _session(
            project_id, visibility="private", owner=alice
        )
        await execute(
            "INSERT INTO session_grants (project_id, stream_id, user_id, role) "
            "VALUES (:p, :s, :u, 'participant')",
            {"p": project_id, "s": stream_id, "u": bob},
        )
        for session_id in (project_visible, invited, f"s-{uuid4().hex}"):
            assert not await _dao().guard_personal_use(
                project_id=project_id, session_id=session_id
            )
        assert await _mark(project_id, project_visible) is None
        assert await _mark(project_id, invited) is None


async def test_a_marked_session_cannot_be_shared():
    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        _, session_id = await _session(project_id, visibility="private", owner=alice)
        await _dao().guard_personal_use(project_id=project_id, session_id=session_id)
        expected = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=alice)

        with pytest.raises(SessionUsedPersonalAccounts):
            await _dao().set_session_sharing(
                project_id=project_id,
                session_id=session_id,
                expected=expected,
                change=_invite(bob),
                user_id=alice,
            )
        with pytest.raises(SessionUsedPersonalAccounts):
            await _dao().set_session_sharing(
                project_id=project_id,
                session_id=session_id,
                expected=expected,
                change=SessionSharingChange(visibility=Visibility.PROJECT),
                user_id=alice,
            )
        # Keeping it private is still allowed.
        await _dao().set_session_sharing(
            project_id=project_id,
            session_id=session_id,
            expected=expected,
            change=SessionSharingChange(
                visibility=Visibility.PRIVATE, remove_all_grants=True
            ),
            user_id=alice,
        )


async def test_sharing_races_with_first_personal_use_exactly_one_wins():
    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        for _ in range(5):
            _, session_id = await _session(
                project_id, visibility="private", owner=alice
            )
            used, shared = await asyncio.gather(
                _dao().guard_personal_use(project_id=project_id, session_id=session_id),
                _dao().set_session_sharing(
                    project_id=project_id,
                    session_id=session_id,
                    expected=AccessPolicy(
                        visibility=Visibility.PRIVATE, owner_user_id=alice
                    ),
                    change=_invite(bob),
                    user_id=alice,
                ),
                return_exceptions=True,
            )
            shared_won = not isinstance(shared, BaseException)
            assert used is not shared_won, (used, shared)
            if not shared_won:
                assert isinstance(shared, SessionUsedPersonalAccounts)


async def test_a_grant_committed_while_the_guard_waits_is_seen():
    """The sharing write holds the row lock and commits a grant; the guard, blocked on
    that lock, must read the grant after it gets the lock (not its first snapshot)."""
    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        stream_id, session_id = await _session(
            project_id, visibility="private", owner=alice
        )
        engine = get_transactions_engine()
        async with engine.transaction() as sharing:
            await sharing.execute(
                text(
                    "SELECT id FROM session_streams WHERE project_id = :p "
                    "AND session_id = :s FOR UPDATE"
                ),
                {"p": project_id, "s": session_id},
            )
            guard = asyncio.create_task(
                _dao().guard_personal_use(project_id=project_id, session_id=session_id)
            )
            await asyncio.sleep(0.5)
            assert not guard.done()
            await sharing.execute(
                text(
                    "INSERT INTO session_grants (project_id, stream_id, user_id, role) "
                    "VALUES (:p, :s, :u, 'participant')"
                ),
                {"p": project_id, "s": stream_id, "u": bob},
            )
        assert await guard is False
        assert await _mark(project_id, session_id) is None


async def test_a_private_channel_session_refuses_a_humans_personal_use():
    async with seeded("alice") as org:
        project_id, alice = org.project_ids[0], org.user_ids["alice"]
        _, session_id = await _session(project_id, visibility="private", owner=alice)
        await execute(
            "INSERT INTO channel_threads (project_id, id, space_id, agent_id, "
            "session_id) VALUES (:p, :id, :space, :a, :s)",
            {
                "p": project_id,
                "id": uuid4(),
                "space": uuid4(),
                "a": uuid4(),
                "s": session_id,
            },
        )
        assert not await _dao().guard_personal_use(
            project_id=project_id, session_id=session_id
        )
