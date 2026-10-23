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
from oss.src.core.sharing.dtos import (
    AccessPolicy,
    SessionGrantInput,
    SessionRole,
    SessionSharingChange,
    Visibility,
)
from oss.src.core.sharing.types import SharedItemNotFound, SharingConflict
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
        assert result.deactivated_channel_agent_ids == []
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


async def test_make_private_deactivates_channel_agents():
    async with seeded("alice") as org:
        project_id, alice = _project(org), org.user_ids["alice"]
        artifact_id, slug, variant_id, revision_id = await _artifact(
            project_id, owner=alice
        )
        other_id, *_ = await _artifact(project_id)

        by_id = await _channel_agent(
            project_id,
            references={"workflow": {"id": str(artifact_id)}},
            flags={"is_active": True, "is_default": False},
        )
        by_slug = await _channel_agent(
            project_id, references={"workflow": {"slug": slug}}, flags=None
        )
        by_revision = await _channel_agent(
            project_id,
            references={"workflow_revision": {"id": str(revision_id)}},
            flags={},
        )
        by_variant = await _channel_agent(
            project_id,
            references={"application_variant": {"id": str(variant_id)}},
            flags={"is_active": True},
        )
        unrelated = await _channel_agent(
            project_id,
            references={"workflow": {"id": str(other_id)}},
            flags={"is_active": True},
        )
        # JSONB null (not SQL NULL): the write must still produce an object.
        json_null = await _channel_agent(
            project_id, references={"workflow": {"id": str(artifact_id)}}
        )
        await execute(
            "UPDATE channel_agents SET flags = 'null'::jsonb "
            "WHERE project_id = :p AND id = :id",
            {"p": project_id, "id": json_null},
        )
        already_off = await _channel_agent(
            project_id,
            references={"workflow": {"id": str(artifact_id)}},
            flags={"is_active": False},
        )

        result = await _dao().set_agent_policy(
            project_id=project_id,
            artifact_id=artifact_id,
            expected=_project_policy(alice),
            policy=_private(alice),
            user_id=alice,
        )

        assert set(result.deactivated_channel_agent_ids) == {
            by_id,
            by_slug,
            by_revision,
            by_variant,
            json_null,
        }
        for agent_id in (
            by_id,
            by_slug,
            by_revision,
            by_variant,
            json_null,
            already_off,
        ):
            assert (await _channel_agent_flags(project_id, agent_id))[
                "is_active"
            ] is False
        # The merge keeps the other flags.
        assert (await _channel_agent_flags(project_id, by_id))["is_default"] is False
        assert (await _channel_agent_flags(project_id, unrelated)) == {
            "is_active": True
        }

        # Making it project-visible again reactivates none.
        again = await _dao().set_agent_policy(
            project_id=project_id,
            artifact_id=artifact_id,
            expected=_private(alice),
            policy=_project_policy(alice),
            user_id=alice,
        )
        assert again.deactivated_channel_agent_ids == []
        for agent_id in (by_id, by_slug, by_revision, by_variant):
            assert (await _channel_agent_flags(project_id, agent_id))[
                "is_active"
            ] is False


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
