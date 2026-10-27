"""`SharingDAO` on the real database: locked compare-and-write, the channel-agent
deactivation, and the session policy reads.

Every test seeds its own organization (`seed_organization`) and writes rows only in its
project, so the row locks under test never touch rows of tests that run in parallel.
The organization delete in `finally` cascades to every row written here.
"""

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Optional
from uuid import UUID, uuid4

import pytest

import oss.src.models.db_models  # noqa: F401  (the ORM tables the streams DAO joins)
from oss.src.core.channels.dtos import (
    ChannelBindingRestore,
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentDataEdit,
    ChannelAgentEdit,
    ChannelAgentFlags,
)
from oss.src.core.shared.dtos import Reference
from oss.src.core.sharing.dtos import (
    AccessPolicy,
    SessionGrantInput,
    SessionRole,
    SessionSharingChange,
    Visibility,
)
from oss.src.core.sharing.types import SharedItemNotFound, SharingConflict
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
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


def _project(org) -> UUID:
    return org.project_ids[0]


def _private(user_id: UUID) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=user_id)


def _project_policy(user_id: Optional[UUID]) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=user_id)


async def _artifact(project_id: UUID, *, owner: Optional[UUID] = None):
    """An agent artifact with one variant and one revision. Returns
    (artifact_id, slug, variant_id, revision_id)."""

    artifact_id, variant_id, revision_id = uuid4(), uuid4(), uuid4()
    slug = f"agent-{artifact_id.hex[:12]}"
    await execute(
        "INSERT INTO workflow_artifacts (project_id, id, slug) VALUES (:p, :a, :s)",
        {"p": project_id, "a": artifact_id, "s": slug},
    )
    await execute(
        "INSERT INTO workflow_variants (project_id, artifact_id, id, slug) "
        "VALUES (:p, :a, :v, :s)",
        {"p": project_id, "a": artifact_id, "v": variant_id, "s": f"{slug}.default"},
    )
    await execute(
        "INSERT INTO workflow_revisions (project_id, artifact_id, variant_id, id, "
        "slug, author, flags) VALUES (:p, :a, :v, :r, :s, :p, "
        "CAST('{\"is_agent\": true}' AS jsonb))",
        {
            "p": project_id,
            "a": artifact_id,
            "v": variant_id,
            "r": revision_id,
            "s": f"{slug}.r1",
        },
    )
    if owner is not None:
        await execute(
            "INSERT INTO agent_access (project_id, artifact_id, visibility, "
            "owner_user_id) VALUES (:p, :a, 'project', :o)",
            {"p": project_id, "a": artifact_id, "o": owner},
        )
    return artifact_id, slug, variant_id, revision_id


async def _channel_agent(project_id: UUID, *, references: dict, flags=None) -> UUID:
    agent_id = uuid4()
    await execute(
        "INSERT INTO channel_agents (project_id, id, connection_id, slug, data, flags) "
        "VALUES (:p, :id, :c, :s, CAST(:data AS json), CAST(:flags AS jsonb))",
        {
            "p": project_id,
            "id": agent_id,
            "c": uuid4(),
            "s": f"bot-{agent_id.hex[:12]}",
            "data": json.dumps({"references": references}),
            "flags": None if flags is None else json.dumps(flags),
        },
    )
    return agent_id


async def _channel_agent_flags(project_id: UUID, agent_id: UUID):
    rows = await fetch_all(
        "SELECT flags FROM channel_agents WHERE project_id = :p AND id = :id",
        {"p": project_id, "id": agent_id},
    )
    return rows[0]["flags"]


async def _session(
    project_id: UUID,
    *,
    visibility: Optional[str],
    owner: Optional[UUID] = None,
    created_by: Optional[UUID] = None,
    references=None,
):
    stream_id, session_id = uuid4(), f"s-{uuid4().hex}"
    await execute(
        "INSERT INTO session_streams (project_id, id, session_id, visibility, "
        'owner_user_id, created_by_id, "references") '
        "VALUES (:p, :id, :s, :v, :o, :u, CAST(:refs AS jsonb))",
        {
            "p": project_id,
            "id": stream_id,
            "s": session_id,
            "v": visibility,
            "o": owner,
            "u": created_by,
            "refs": None if references is None else json.dumps(references),
        },
    )
    return stream_id, session_id


async def _grant(project_id: UUID, stream_id: UUID, user_id: UUID, role: str):
    await execute(
        "INSERT INTO session_grants (project_id, stream_id, user_id, role) "
        "VALUES (:p, :s, :u, :r)",
        {"p": project_id, "s": stream_id, "u": user_id, "r": role},
    )


async def _settle(*calls):
    """Run the calls concurrently, on their own transactions. Returns (results,
    errors) in call order."""

    outcomes = await asyncio.gather(*calls, return_exceptions=True)
    for outcome in outcomes:
        if isinstance(outcome, BaseException) and not isinstance(
            outcome, SharingConflict
        ):
            raise outcome
    return outcomes


# -- agents -----------------------------------------------------------------------------


async def test_concurrent_take_ownership_one_wins():
    async with seeded("carol", "dana", "erin") as org:
        project_id = _project(org)
        carol, dana, erin = (org.user_ids[k] for k in ("carol", "dana", "erin"))
        artifact_id, *_ = await _artifact(project_id, owner=carol)
        expected = _project_policy(carol)  # carol has left: take ownership is open

        outcomes = await _settle(
            *(
                _dao().set_agent_policy(
                    project_id=project_id,
                    artifact_id=artifact_id,
                    expected=expected,
                    policy=_project_policy(user),
                    user_id=user,
                )
                for user in (dana, erin)
            )
        )

        winners = [o for o in outcomes if not isinstance(o, SharingConflict)]
        losers = [o for o in outcomes if isinstance(o, SharingConflict)]
        assert len(winners) == 1 and len(losers) == 1
        assert losers[0].current == winners[0].policy
        assert winners[0].policy.owner_user_id in (dana, erin)
        assert (
            await _dao().fetch_agent_policy(
                project_id=project_id, artifact_id=artifact_id
            )
            == winners[0].policy
        )


async def test_transfer_against_make_private():
    async with seeded("alice", "carol") as org:
        project_id = _project(org)
        alice, carol = org.user_ids["alice"], org.user_ids["carol"]
        artifact_id, *_ = await _artifact(project_id, owner=alice)
        expected = _project_policy(alice)

        transfer = _project_policy(carol)
        make_private = _private(alice)
        outcomes = await _settle(
            _dao().set_agent_policy(
                project_id=project_id,
                artifact_id=artifact_id,
                expected=expected,
                policy=transfer,
                user_id=alice,
            ),
            _dao().set_agent_policy(
                project_id=project_id,
                artifact_id=artifact_id,
                expected=expected,
                policy=make_private,
                user_id=alice,
            ),
        )

        winners = [o for o in outcomes if not isinstance(o, SharingConflict)]
        losers = [o for o in outcomes if isinstance(o, SharingConflict)]
        assert len(winners) == 1 and len(losers) == 1
        stored = await _dao().fetch_agent_policy(
            project_id=project_id, artifact_id=artifact_id
        )
        assert stored == winners[0].policy
        assert losers[0].current == stored


async def test_first_policy_on_an_agent_without_a_row():
    async with seeded("alice") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        artifact_id, *_ = await _artifact(project_id)
        dao = _dao()

        assert (
            await dao.fetch_agent_policy(project_id=project_id, artifact_id=artifact_id)
            is None
        )
        # `expected` names the current state: a stale "has a row" expectation fails.
        with pytest.raises(SharingConflict) as conflict:
            await dao.set_agent_policy(
                project_id=project_id,
                artifact_id=artifact_id,
                expected=_project_policy(alice),
                policy=_private(alice),
                user_id=alice,
            )
        assert conflict.value.current is None

        result = await dao.set_agent_policy(
            project_id=project_id,
            artifact_id=artifact_id,
            expected=None,
            policy=_project_policy(alice),
            user_id=alice,
        )
        assert result.policy == _project_policy(alice)
        rows = await fetch_all(
            "SELECT created_by_id, updated_by_id FROM agent_access "
            "WHERE project_id = :p AND artifact_id = :a",
            {"p": project_id, "a": artifact_id},
        )
        assert (rows[0]["created_by_id"], rows[0]["updated_by_id"]) == (alice, None)


async def test_unknown_or_foreign_artifact_is_not_found():
    async with seeded("alice") as org, seeded("bob") as other:
        alice = org.user_ids["alice"]
        foreign_artifact, *_ = await _artifact(_project(other))
        for artifact_id in (uuid4(), foreign_artifact):
            with pytest.raises(SharedItemNotFound):
                await _dao().set_agent_policy(
                    project_id=_project(org),
                    artifact_id=artifact_id,
                    expected=None,
                    policy=_private(alice),
                    user_id=alice,
                )


async def test_make_private_keeps_channel_agents_active():
    """A private agent may answer a channel: a make-private changes no binding."""

    async with seeded("alice") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        artifact_id, slug, _variant_id, revision_id = await _artifact(
            project_id, owner=alice
        )

        by_id = await _channel_agent(
            project_id,
            references={"workflow": {"id": str(artifact_id)}},
            flags={"is_active": True, "is_default": False},
        )
        by_slug = await _channel_agent(
            project_id,
            references={"workflow": {"slug": slug}},
            flags={"is_active": True},
        )
        by_revision = await _channel_agent(
            project_id,
            references={"workflow_revision": {"id": str(revision_id)}},
            flags={"is_active": True},
        )

        result = await _dao().set_agent_policy(
            project_id=project_id,
            artifact_id=artifact_id,
            expected=_project_policy(alice),
            policy=_private(alice),
            user_id=alice,
        )

        assert result.policy == _private(alice)
        for agent_id in (by_id, by_slug, by_revision):
            assert (await _channel_agent_flags(project_id, agent_id))[
                "is_active"
            ] is True


# -- sessions ---------------------------------------------------------------------------


async def test_session_policy_state_reads_channel_and_agent_flags():
    async with seeded("alice") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        agent_session = await _session(
            project_id,
            visibility="private",
            owner=alice,
            references=[{"key": "workflow_revision", "id": str(uuid4())}],
        )
        untagged = await _session(
            project_id,
            visibility="project",
            references=[{"id": str(uuid4())}, {"key": "testset", "id": str(uuid4())}],
        )
        channel = await _session(project_id, visibility="project")
        await execute(
            "INSERT INTO channel_threads (project_id, id, space_id, agent_id, "
            "session_id) VALUES (:p, :id, :space, :agent, :s)",
            {
                "p": project_id,
                "id": uuid4(),
                "space": uuid4(),
                "agent": uuid4(),
                "s": channel[1],
            },
        )
        dao = _dao()

        state = await dao.fetch_session_policy(
            project_id=project_id, session_id=agent_session[1]
        )
        assert state.stream_id == agent_session[0]
        assert state.policy == _private(alice)
        assert (state.is_channel, state.references_agent) == (False, True)

        state = await dao.fetch_session_policy(
            project_id=project_id, session_id=untagged[1]
        )
        assert (state.is_channel, state.references_agent) == (False, False)

        state = await dao.fetch_session_policy(
            project_id=project_id, session_id=channel[1]
        )
        assert state.policy == _project_policy(None)
        assert (state.is_channel, state.references_agent) == (True, False)

        assert (
            await dao.fetch_session_policy(project_id=project_id, session_id="nope")
            is None
        )


async def test_legacy_row_is_assigned_on_first_read():
    async with seeded("alice") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        stream_id, session_id = await _session(
            project_id, visibility=None, created_by=uuid4()
        )
        await execute(
            "INSERT INTO session_turns (project_id, id, session_id, stream_id, "
            "turn_index, harness_kind, principal_kind, principal_id, sender_user_id, "
            "origin) VALUES (:p, :id, :s, :st, 0, 'pi', 'human', :u, :u, 'web')",
            {
                "p": project_id,
                "id": uuid4(),
                "s": session_id,
                "st": stream_id,
                "u": alice,
            },
        )

        state = await _dao().fetch_session_policy(
            project_id=project_id, session_id=session_id
        )
        assert state.policy == _project_policy(alice)
        rows = await fetch_all(
            "SELECT visibility, owner_user_id FROM session_streams WHERE id = :id",
            {"id": stream_id},
        )
        assert (rows[0]["visibility"], rows[0]["owner_user_id"]) == ("project", alice)

        # Idempotent: a second assignment changes nothing.
        await _dao().assign_legacy_session_access(
            project_id=project_id, session_id=session_id
        )
        assert (
            await _dao().fetch_session_policy(
                project_id=project_id, session_id=session_id
            )
        ).policy == _project_policy(alice)


async def test_only_the_channel_run_creates_a_channel_thread_s_session():
    """A channel thread names the session id. Any other creator, another binding's run
    included, inserts nothing (the id is reserved, answered as a hidden session); the
    thread's own binding's run inserts the row with the policy it asks for (private to
    the agent's owner for a private agent)."""

    from oss.src.core.sessions.streams.dtos import SessionStreamCreate
    from oss.src.core.sessions.streams.types import SessionIdTombstoned

    async with seeded("alice") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        streams = SessionStreamsDAO(engine=get_transactions_engine())
        session_id, binding_id = f"s-{uuid4().hex}", uuid4()
        await execute(
            "INSERT INTO channel_threads (project_id, id, space_id, agent_id, "
            "session_id) VALUES (:p, :id, :space, :agent, :s)",
            {
                "p": project_id,
                "id": uuid4(),
                "space": uuid4(),
                "agent": binding_id,
                "s": session_id,
            },
        )
        row_of = (
            "SELECT visibility, owner_user_id FROM session_streams "
            "WHERE project_id = :p AND session_id = :s"
        )

        with pytest.raises(SessionIdTombstoned):
            await streams.create(
                project_id=project_id,
                user_id=alice,
                stream=SessionStreamCreate(
                    session_id=session_id, access=_private(alice)
                ),
            )
        assert await fetch_all(row_of, {"p": project_id, "s": session_id}) == []

        # Another binding's run refuses too.
        with pytest.raises(SessionIdTombstoned):
            await streams.create(
                project_id=project_id,
                user_id=None,
                stream=SessionStreamCreate(
                    session_id=session_id,
                    access=_project_policy(None),
                    channel_binding_id=uuid4(),
                ),
            )
        assert await fetch_all(row_of, {"p": project_id, "s": session_id}) == []

        created = await streams.create(
            project_id=project_id,
            user_id=None,
            stream=SessionStreamCreate(
                session_id=session_id,
                access=_private(alice),
                channel_binding_id=binding_id,
            ),
        )
        assert created.has_channel_thread is True
        rows = await fetch_all(row_of, {"p": project_id, "s": session_id})
        assert (rows[0]["visibility"], rows[0]["owner_user_id"]) == ("private", alice)


async def test_killed_and_archived_sessions_keep_their_policy():
    async with seeded("alice") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        _, session_id = await _session(project_id, visibility="private", owner=alice)
        streams = SessionStreamsDAO(engine=get_transactions_engine())

        assert await streams.delete_by_session_id(
            project_id=project_id, session_id=session_id
        )
        state = await _dao().fetch_session_policy(
            project_id=project_id, session_id=session_id
        )
        assert state.policy == _private(alice)

        await streams.set_archived_by_session_id(
            project_id=project_id, user_id=alice, session_id=session_id
        )
        state = await _dao().fetch_session_policy(
            project_id=project_id, session_id=session_id
        )
        assert state.policy == _private(alice)

        # Only a hard delete makes the session unknown.
        await streams.hard_delete_by_session_id(
            project_id=project_id, session_id=session_id
        )
        assert (
            await _dao().fetch_session_policy(
                project_id=project_id, session_id=session_id
            )
            is None
        )


async def test_only_me_against_grant_add():
    async with seeded("alice", "bob", "carol") as org:
        project_id = _project(org)
        alice, bob, carol = (org.user_ids[k] for k in ("alice", "bob", "carol"))
        stream_id, session_id = await _session(
            project_id, visibility="project", owner=alice
        )
        await _grant(project_id, stream_id, carol, "viewer")
        expected = _project_policy(alice)

        only_me = SessionSharingChange(
            visibility=Visibility.PRIVATE, remove_all_grants=True
        )
        add_bob = SessionSharingChange(
            upsert_grants=[SessionGrantInput(user_id=bob, role=SessionRole.PARTICIPANT)]
        )
        outcomes = await _settle(
            _dao().set_session_sharing(
                project_id=project_id,
                session_id=session_id,
                expected=expected,
                change=only_me,
                user_id=alice,
            ),
            _dao().set_session_sharing(
                project_id=project_id,
                session_id=session_id,
                expected=expected,
                change=add_bob,
                user_id=alice,
            ),
        )

        state = await _dao().fetch_session_policy(
            project_id=project_id, session_id=session_id
        )
        grants = {
            g.user_id: g.role
            for g in await _dao().list_session_grants(
                project_id=project_id, stream_id=stream_id
            )
        }
        only_me_ok, add_bob_ok = (not isinstance(o, SharingConflict) for o in outcomes)
        # Serial orders: only-me first -> the grant add sees PRIVATE and conflicts, so
        # private and no grants; grant add first -> the policy is unchanged, so only-me
        # still applies and removes both grants. Never a half state.
        assert only_me_ok
        assert state.policy == _private(alice)
        assert grants == {}
        if add_bob_ok:
            assert {g.user_id for g in outcomes[1].grants} == {bob, carol}
            assert set(outcomes[0].removed_user_ids) == {bob, carol}
        else:
            assert outcomes[1].current == _private(alice)
            assert set(outcomes[0].removed_user_ids) == {carol}


async def test_concurrent_invites_both_land():
    async with seeded("alice", "bob", "carol") as org:
        project_id = _project(org)
        alice, bob, carol = (org.user_ids[k] for k in ("alice", "bob", "carol"))
        stream_id, session_id = await _session(
            project_id, visibility="private", owner=alice
        )
        expected = _private(alice)

        outcomes = await _settle(
            *(
                _dao().set_session_sharing(
                    project_id=project_id,
                    session_id=session_id,
                    expected=expected,
                    change=SessionSharingChange(
                        upsert_grants=[
                            SessionGrantInput(user_id=user, role=SessionRole.VIEWER)
                        ]
                    ),
                    user_id=alice,
                )
                for user in (bob, carol)
            )
        )

        assert not any(isinstance(o, SharingConflict) for o in outcomes)
        grants = await _dao().list_session_grants(
            project_id=project_id, stream_id=stream_id
        )
        assert {g.user_id: g.role for g in grants} == {
            bob: SessionRole.VIEWER,
            carol: SessionRole.VIEWER,
        }
        assert all(g.created_by_id == alice and g.created_at for g in grants)
        # The second writer saw the first one's grant under the lock.
        assert max(len(o.grants) for o in outcomes) == 2


async def test_write_result_reports_removed_users():
    async with seeded("alice", "bob", "carol") as org:
        project_id = _project(org)
        alice, bob, carol = (org.user_ids[k] for k in ("alice", "bob", "carol"))
        stream_id, session_id = await _session(
            project_id, visibility="project", owner=alice
        )
        await _grant(project_id, stream_id, bob, "viewer")
        await _grant(project_id, stream_id, carol, "participant")

        result = await _dao().set_session_sharing(
            project_id=project_id,
            session_id=session_id,
            expected=_project_policy(alice),
            change=SessionSharingChange(remove_all_grants=True),
            user_id=alice,
        )

        assert set(result.removed_user_ids) == {bob, carol}
        assert result.before == _project_policy(alice)
        assert result.state.policy == _project_policy(alice)
        assert result.grants == [] and result.upserted == []
        assert await _dao().list_user_grants(project_id=project_id, user_id=bob) == []


async def test_write_result_reports_only_real_changes():
    async with seeded("alice", "bob", "carol", "dana") as org:
        project_id = _project(org)
        alice, bob, carol, dana = (
            org.user_ids[k] for k in ("alice", "bob", "carol", "dana")
        )
        stream_id, session_id = await _session(
            project_id, visibility="private", owner=alice
        )
        await _grant(project_id, stream_id, bob, "viewer")
        await _grant(project_id, stream_id, carol, "viewer")

        result = await _dao().set_session_sharing(
            project_id=project_id,
            session_id=session_id,
            expected=_private(alice),
            change=SessionSharingChange(
                visibility=Visibility.PROJECT,
                upsert_grants=[
                    SessionGrantInput(user_id=bob, role=SessionRole.VIEWER),  # same
                    SessionGrantInput(user_id=carol, role=SessionRole.PARTICIPANT),
                    SessionGrantInput(user_id=dana, role=SessionRole.VIEWER),
                ],
                remove_user_ids=[uuid4()],  # no such grant
            ),
            user_id=alice,
        )

        assert result.before == _private(alice)
        assert result.state.policy == _project_policy(alice)
        assert {(i.user_id, i.role) for i in result.upserted} == {
            (carol, SessionRole.PARTICIPANT),
            (dana, SessionRole.VIEWER),
        }
        assert result.removed_user_ids == []
        assert {(g.user_id, g.role) for g in result.grants} == {
            (bob, SessionRole.VIEWER),
            (carol, SessionRole.PARTICIPANT),
            (dana, SessionRole.VIEWER),
        }
        stored = await _dao().list_session_grants(
            project_id=project_id, stream_id=stream_id
        )
        assert sorted(stored, key=lambda g: g.user_id) == sorted(
            result.grants, key=lambda g: g.user_id
        )
        grants_of_dana = await _dao().list_user_grants(
            project_id=project_id, user_id=dana
        )
        assert [(g.stream_id, g.owner_user_id) for g in grants_of_dana] == [
            (stream_id, alice)
        ]


async def test_session_write_conflicts_and_unknown_session():
    async with seeded("alice") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        _, session_id = await _session(project_id, visibility="private", owner=alice)

        with pytest.raises(SharingConflict) as conflict:
            await _dao().set_session_sharing(
                project_id=project_id,
                session_id=session_id,
                expected=_project_policy(alice),
                change=SessionSharingChange(visibility=Visibility.PROJECT),
                user_id=alice,
            )
        assert conflict.value.current == _private(alice)

        with pytest.raises(SharedItemNotFound):
            await _dao().set_session_sharing(
                project_id=project_id,
                session_id="nope",
                expected=_private(alice),
                change=SessionSharingChange(visibility=Visibility.PROJECT),
                user_id=alice,
            )


# -- channel activation against make-private (deviation 19) ----------------------------


def _channels_dao() -> ChannelsDAO:
    return ChannelsDAO(engine=get_transactions_engine())


def _binding(artifact_id: UUID, *, is_active: bool = True) -> ChannelAgentCreate:
    return ChannelAgentCreate(
        connection_id=uuid4(),
        slug=f"bot-{uuid4().hex[:12]}",
        data=ChannelAgentData(references={"workflow": Reference(id=artifact_id)}),
        flags=ChannelAgentFlags(is_active=is_active),
    )


async def _active_bindings(project_id: UUID, artifact_id: UUID) -> list:
    return await fetch_all(
        "SELECT id FROM channel_agents WHERE project_id = :p "
        "AND (data -> 'references' -> 'workflow' ->> 'id') = :a "
        "AND (flags ->> 'is_active') IS DISTINCT FROM 'false'",
        {"p": project_id, "a": str(artifact_id)},
    )


async def test_activation_guard_refuses_a_private_agent_of_someone_else():
    """Only the owner of a private agent writes an active binding of it."""

    async with seeded("alice", "bob") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        bob = org.user_ids["bob"]
        private, *_ = await _artifact(project_id, owner=alice)
        await execute(
            "UPDATE agent_access SET visibility = 'private' "
            "WHERE project_id = :p AND artifact_id = :a",
            {"p": project_id, "a": private},
        )
        shared, *_ = await _artifact(project_id, owner=alice)
        ownerless, *_ = await _artifact(project_id)

        with pytest.raises(SharedItemNotFound):
            await _channels_dao().create_agent(
                project_id=project_id,
                user_id=bob,
                agent=_binding(private),
                guard_artifact_id=private,
                guard_user_id=bob,
            )
        assert await _active_bindings(project_id, private) == []

        # Its owner binds it.
        await _channels_dao().create_agent(
            project_id=project_id,
            user_id=alice,
            agent=_binding(private),
            guard_artifact_id=private,
            guard_user_id=alice,
        )
        assert len(await _active_bindings(project_id, private)) == 1

        for artifact_id in (shared, ownerless):
            await _channels_dao().create_agent(
                project_id=project_id,
                user_id=bob,
                agent=_binding(artifact_id),
                guard_artifact_id=artifact_id,
                guard_user_id=bob,
            )
            assert len(await _active_bindings(project_id, artifact_id)) == 1

        # Reactivating an inactive binding of someone else's private agent is refused
        # too.
        inactive = await _channels_dao().create_agent(
            project_id=project_id,
            user_id=bob,
            agent=_binding(private, is_active=False),
        )
        with pytest.raises(SharedItemNotFound):
            await _channels_dao().edit_agent(
                project_id=project_id,
                user_id=bob,
                agent=ChannelAgentEdit(
                    id=inactive.id,
                    data=ChannelAgentDataEdit(
                        references={"workflow": Reference(id=private)}
                    ),
                    flags=ChannelAgentFlags(is_active=True),
                ),
                guard_artifact_id=private,
                guard_user_id=bob,
            )
        assert len(await _active_bindings(project_id, private)) == 1


async def test_unarchive_restores_someone_else_s_private_agent_binding_off():
    """Restoring a connection restores the bindings archived with it. A binding of a
    private agent comes back on only for its owner; for anyone else it comes back
    off, under the same artifact lock as an activation."""

    from datetime import datetime, timezone

    async with seeded("alice", "bob") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        bob = org.user_ids["bob"]
        private, *_ = await _artifact(project_id, owner=alice)
        await execute(
            "UPDATE agent_access SET visibility = 'private' "
            "WHERE project_id = :p AND artifact_id = :a",
            {"p": project_id, "a": private},
        )

        for user_id, expected in ((bob, False), (alice, True)):
            archived_at = datetime.now(timezone.utc)
            connection_id, binding_id = uuid4(), uuid4()
            await execute(
                "INSERT INTO channel_connections (id, project_id, channel, "
                "external_key, slug, deleted_at) VALUES (:id, :p, 'agenta', :ek, "
                ":slug, :at)",
                {
                    "id": connection_id,
                    "p": project_id,
                    "ek": str(uuid4()),
                    "slug": f"c-{connection_id.hex[:8]}",
                    "at": archived_at,
                },
            )
            await execute(
                "INSERT INTO channel_agents (project_id, id, connection_id, slug, "
                "data, flags, deleted_at) VALUES (:p, :id, :c, :s, "
                "CAST(:data AS json), CAST(:flags AS jsonb), :at)",
                {
                    "p": project_id,
                    "id": binding_id,
                    "c": connection_id,
                    "s": f"bot-{binding_id.hex[:12]}",
                    "data": json.dumps(
                        {"references": {"workflow": {"id": str(private)}}}
                    ),
                    "flags": json.dumps({"is_active": True}),
                    "at": archived_at,
                },
            )
            restored = await _channels_dao().unarchive_connection(
                project_id=project_id,
                user_id=user_id,
                connection_id=connection_id,
                guard_bindings={
                    binding_id: ChannelBindingRestore(
                        references={"workflow": Reference(id=private)},
                        artifact_id=private,
                    )
                },
                guard_user_id=user_id,
            )
            assert restored is not None and restored.deleted_at is None
            flags = await _channel_agent_flags(project_id, binding_id)
            assert flags["is_active"] is expected, user_id


async def _archived_connection(
    project_id: UUID, artifact_id: UUID, *, channel="agenta"
):
    """An archived connection with one active binding of `artifact_id`, archived with
    it. Returns (connection_id, binding_id)."""

    from datetime import datetime, timezone

    archived_at = datetime.now(timezone.utc)
    connection_id, binding_id = uuid4(), uuid4()
    await execute(
        "INSERT INTO channel_connections (id, project_id, channel, external_key, slug, "
        "deleted_at) VALUES (:id, :p, :ch, :ek, :slug, :at)",
        {
            "id": connection_id,
            "p": project_id,
            "ch": channel,
            "ek": str(uuid4()),
            "slug": f"c-{connection_id.hex[:8]}",
            "at": archived_at,
        },
    )
    await execute(
        "INSERT INTO channel_agents (project_id, id, connection_id, slug, data, flags, "
        "deleted_at) VALUES (:p, :id, :c, :s, CAST(:data AS json), "
        "CAST(:flags AS jsonb), :at)",
        {
            "p": project_id,
            "id": binding_id,
            "c": connection_id,
            "s": "default",
            "data": json.dumps({"references": {"workflow": {"id": str(artifact_id)}}}),
            "flags": json.dumps({"is_active": True, "is_default": True}),
            "at": archived_at,
        },
    )
    return connection_id, binding_id


async def test_a_binding_retargeted_before_the_restore_comes_back_off():
    """Bob's restore read a binding of a project agent. Before it runs, Alice points
    that archived binding at her private agent. The restore checks the binding rows it
    locks: the binding changed since the read, so it comes back off, not active on
    Alice's private agent."""

    async with seeded("alice", "bob") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        bob = org.user_ids["bob"]
        private, *_ = await _artifact(project_id, owner=alice)
        await execute(
            "UPDATE agent_access SET visibility = 'private' "
            "WHERE project_id = :p AND artifact_id = :a",
            {"p": project_id, "a": private},
        )
        shared, *_ = await _artifact(project_id, owner=alice)

        for retarget, expected in ((False, True), (True, False)):
            connection_id, binding_id = await _archived_connection(project_id, shared)
            read = {
                binding_id: ChannelBindingRestore(
                    references={"workflow": Reference(id=shared)}, artifact_id=shared
                )
            }
            if retarget:
                await execute(
                    "UPDATE channel_agents SET data = CAST(:data AS json) "
                    "WHERE project_id = :p AND id = :id",
                    {
                        "p": project_id,
                        "id": binding_id,
                        "data": json.dumps(
                            {"references": {"workflow": {"id": str(private)}}}
                        ),
                    },
                )
            restored = await _channels_dao().unarchive_connection(
                project_id=project_id,
                user_id=bob,
                connection_id=connection_id,
                guard_bindings=read,
                guard_user_id=bob,
            )
            assert restored is not None and restored.deleted_at is None
            flags = await _channel_agent_flags(project_id, binding_id)
            assert flags["is_active"] is expected, retarget


class _AgentOfReferences:
    """`resolve_agent_artifact_id` that names the agent of the `workflow` reference."""

    async def resolve_agent_artifact_id(self, *, project_id, references):
        return next(r.id for r in references if r.key == "workflow")


async def test_telegram_reconnect_turns_on_the_binding_it_points_at(monkeypatch):
    """Alice's hosted Telegram connection answered with her private agent and was
    disconnected. Bob connects it again with a project agent: the restore brings
    Alice's binding back off (not his to turn on), and the connect points it at Bob's
    agent and turns it on, so the bind link he gets answers."""

    from unittest.mock import AsyncMock, MagicMock

    from oss.src.core.channels.service import ChannelsService

    monkeypatch.setattr(
        "oss.src.core.channels.service.invalidate_principals_after_write",
        AsyncMock(),
    )
    async with seeded("alice", "bob") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        bob = org.user_ids["bob"]
        private, *_ = await _artifact(project_id, owner=alice)
        await execute(
            "UPDATE agent_access SET visibility = 'private' "
            "WHERE project_id = :p AND artifact_id = :a",
            {"p": project_id, "a": private},
        )
        shared, *_ = await _artifact(project_id, owner=alice)
        connection_id, binding_id = await _archived_connection(
            project_id, private, channel="telegram_hosted"
        )
        service = ChannelsService(
            channels_dao=_channels_dao(),
            adapter_registry=MagicMock(),
            workflows_service=_AgentOfReferences(),
        )

        connection = await service.ensure_hosted_telegram_connection(
            project_id=project_id,
            user_id=bob,
            guard_user_id=bob,
            references={"workflow": {"id": str(shared)}},
        )

        assert connection.id == connection_id and connection.deleted_at is None
        assert [row["id"] for row in await _active_bindings(project_id, shared)] == [
            binding_id
        ]
        assert await _active_bindings(project_id, private) == []


class _ResolvedWorkflows:
    """`resolve_agent_artifact_id` that names one artifact (the binding's agent)."""

    def __init__(self, artifact_id: UUID):
        self.artifact_id = artifact_id

    async def resolve_agent_artifact_id(self, *, project_id, references):
        return self.artifact_id


async def test_flags_only_reactivation_is_guarded(monkeypatch):
    """A write that sends only `flags.is_active: true` is guarded with the stored
    references, through `edit_agent` (the route) and the internal row write: Bob may
    not reactivate a binding of Alice's private agent."""

    from unittest.mock import AsyncMock, MagicMock

    from oss.src.core.channels.service import ChannelsService

    monkeypatch.setattr(
        "oss.src.core.channels.service.invalidate_principals_after_write",
        AsyncMock(),
    )

    async with seeded("alice", "bob") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        bob = org.user_ids["bob"]
        private, *_ = await _artifact(project_id, owner=alice)
        await execute(
            "UPDATE agent_access SET visibility = 'private' "
            "WHERE project_id = :p AND artifact_id = :a",
            {"p": project_id, "a": private},
        )
        shared, *_ = await _artifact(project_id, owner=alice)

        def _service(artifact_id: UUID) -> ChannelsService:
            return ChannelsService(
                channels_dao=_channels_dao(),
                adapter_registry=MagicMock(),
                workflows_service=_ResolvedWorkflows(artifact_id),
            )

        inactive = await _channels_dao().create_agent(
            project_id=project_id,
            user_id=bob,
            agent=_binding(private, is_active=False),
        )
        service = _service(private)
        for write in (service.edit_agent, service._edit_agent_row):
            with pytest.raises(SharedItemNotFound):
                await write(
                    project_id=project_id,
                    user_id=bob,
                    guard_user_id=bob,
                    agent=ChannelAgentEdit(
                        id=inactive.id, flags=ChannelAgentFlags(is_active=True)
                    ),
                )
            assert (await _channel_agent_flags(project_id, inactive.id))[
                "is_active"
            ] is False
        assert await _active_bindings(project_id, private) == []

        # A project agent's flags-only reactivation works and keeps its references.
        inactive = await _channels_dao().create_agent(
            project_id=project_id,
            user_id=alice,
            agent=_binding(shared, is_active=False),
        )
        edited = await _service(shared).edit_agent(
            project_id=project_id,
            user_id=alice,
            guard_user_id=alice,
            agent=ChannelAgentEdit(
                id=inactive.id, flags=ChannelAgentFlags(is_active=True)
            ),
        )
        assert edited.flags.is_active is True
        assert edited.data.references == {"workflow": Reference(id=shared)}
        assert len(await _active_bindings(project_id, shared)) == 1


async def test_activation_against_make_private():
    """A binding activation and a make-private of the same agent by its owner, 20
    times: whatever the order, both writes commit and the private agent keeps its
    active binding (the artifact lock serializes them)."""

    async with seeded("alice") as org:
        project_id, alice = _project(org), org.user_ids["alice"]

        for attempt in range(20):
            artifact_id, *_ = await _artifact(project_id, owner=alice)
            activate = _channels_dao().create_agent(
                project_id=project_id,
                user_id=alice,
                agent=_binding(artifact_id),
                guard_artifact_id=artifact_id,
                guard_user_id=alice,
            )
            make_private = _dao().set_agent_policy(
                project_id=project_id,
                artifact_id=artifact_id,
                expected=_project_policy(alice),
                policy=_private(alice),
                user_id=alice,
            )

            # Alternate which write starts first.
            if attempt % 2 == 0:
                created, written = await asyncio.gather(
                    activate, make_private, return_exceptions=True
                )
            else:
                written, created = await asyncio.gather(
                    make_private, activate, return_exceptions=True
                )

            assert not isinstance(written, BaseException), written
            assert not isinstance(created, BaseException), created
            assert await _dao().fetch_agent_policy(
                project_id=project_id, artifact_id=artifact_id
            ) == _private(alice)
            assert len(await _active_bindings(project_id, artifact_id)) == 1


# -- sharing write statement counts --------------------------------------------------------


async def test_sharing_write_statement_count(monkeypatch):
    """A sharing write is: the `expected` read, then in one transaction the lock read,
    the compare read and the write. The membership checks read the membership cache,
    not Postgres.
    Pinned numbers (not a hot path; stated in the PR)."""

    import oss.src.core.memberships.service as memberships_module
    import oss.src.core.sharing.service as sharing_module
    from oss.src.core.memberships.dtos import MembershipPolicy
    from oss.src.core.memberships.service import MembershipsService
    from oss.src.core.sharing.service import SharingService
    from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
    from oss.tests.pytest.utils.cache import FakeCache
    from oss.tests.pytest.utils.principals import (
        make_envelope,
        make_request_access,
    )
    from oss.tests.pytest.utils.statements import count_statements

    monkeypatch.setattr(sharing_module, "invalidate_sharing_caches", _noop)
    monkeypatch.setattr(sharing_module, "publish_sharing_event", _noop)
    FakeCache().install(monkeypatch, memberships_module)

    async with seeded("alice", "bob") as org:
        project_id = _project(org)
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        engine = get_transactions_engine()
        service = SharingService(
            sharing_dao=_dao(),
            memberships_service=MembershipsService(
                memberships_dao=MembershipsDAO(engine=engine),
                policy=MembershipPolicy.PROJECT_ROWS,
            ),
        )
        access = make_request_access(
            envelope=make_envelope(
                principal_id=alice,
                project_id=project_id,
                organization_id=org.organization_id,
            ),
            credential_kind="bearer_session",
        )
        kwargs = {
            "organization_id": org.organization_id,
            "project_id": project_id,
            "access": access,
        }
        artifact_id, *_ = await _artifact(project_id, owner=alice)
        _, session_id = await _session(
            project_id,
            visibility="private",
            owner=alice,
            references=[{"key": "workflow", "id": str(artifact_id)}],
        )
        # Warm the membership cache of both users.
        for user_id in (alice, bob):
            await service._is_active(user_id=user_id, project_id=project_id)

        with count_statements(engine) as make_private:
            await service.set_agent_visibility(
                **kwargs, artifact_id=artifact_id, visibility=Visibility.PRIVATE
            )
        with count_statements(engine) as make_project:
            await service.set_agent_visibility(
                **kwargs, artifact_id=artifact_id, visibility=Visibility.PROJECT
            )
        with count_statements(engine) as invite:
            await service.set_session_sharing(
                **kwargs,
                session_id=session_id,
                change=SessionSharingChange(
                    upsert_grants=[
                        SessionGrantInput(user_id=bob, role=SessionRole.VIEWER)
                    ]
                ),
            )

        # expected read + lock + compare read + upsert (a make-private no longer turns
        # channel bindings off)
        assert len(make_private) == 4, make_private
        # expected read + lock + compare read + upsert
        assert len(make_project) == 4, make_project
        # session state read + grants read + lock read + locked grants read + upsert
        assert len(invite) == 5, invite


async def _noop(**_kwargs) -> None:
    return None
