"""`WorkflowsDAO` on the real database: a private agent and its access row commit
together or not at all, and `ensure_first_agent_access` writes the row only for the
first agent revision, under the artifact row lock.

Every test seeds its own organization; the organization delete in `finally` cascades to
every row written here.
"""

import asyncio
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.folders.dbes  # noqa: F401  (workflow_artifacts.folder_id)
import oss.src.models.db_models  # noqa: F401  (the ORM tables)
from oss.src.core.git.dtos import ArtifactCreate
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.sharing.dtos import AccessPolicy, Visibility
from oss.src.core.sharing.types import (
    AgentCreationFailed,
    SharedItemNotFound,
    SharingConflict,
)
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.sharing.dao import SharingDAO
from oss.src.dbs.postgres.sharing.dbes import AgentAccessDBE
from oss.src.dbs.postgres.workflows.dao import WorkflowsDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)
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


def _dao() -> WorkflowsDAO:
    return WorkflowsDAO(
        engine=get_transactions_engine(),
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
    )


def _private(user_id: UUID) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=user_id)


async def _artifacts_with_slug(project_id: UUID, slug: str) -> list:
    return await fetch_all(
        "SELECT id FROM workflow_artifacts WHERE project_id = :p AND slug = :s",
        {"p": project_id, "s": slug},
    )


async def _access_rows(project_id: UUID, artifact_id: UUID) -> list:
    return await fetch_all(
        "SELECT visibility, owner_user_id FROM agent_access "
        "WHERE project_id = :p AND artifact_id = :a",
        {"p": project_id, "a": artifact_id},
    )


async def _bare_artifact(project_id: UUID) -> UUID:
    artifact_id = uuid4()
    await execute(
        "INSERT INTO workflow_artifacts (project_id, id, slug) VALUES (:p, :a, :s)",
        {"p": project_id, "a": artifact_id, "s": f"wf-{artifact_id.hex[:12]}"},
    )
    return artifact_id


async def _revision(
    project_id: UUID, artifact_id: UUID, *, is_agent: bool, variant_id=None
) -> tuple[UUID, UUID]:
    if variant_id is None:
        variant_id = uuid4()
        await execute(
            "INSERT INTO workflow_variants (project_id, artifact_id, id, slug) "
            "VALUES (:p, :a, :v, :s)",
            {"p": project_id, "a": artifact_id, "v": variant_id, "s": variant_id.hex},
        )
    revision_id = uuid4()
    await execute(
        "INSERT INTO workflow_revisions (project_id, artifact_id, variant_id, id, "
        "slug, author, flags) VALUES (:p, :a, :v, :r, :s, :p, CAST(:f AS jsonb))",
        {
            "p": project_id,
            "a": artifact_id,
            "v": variant_id,
            "r": revision_id,
            "s": revision_id.hex,
            "f": '{"is_agent": true}' if is_agent else "{}",
        },
    )
    return variant_id, revision_id


async def test_access_insert_failure_leaves_no_artifact(monkeypatch):
    async with seeded("alice") as org:
        project_id, alice = org.project_ids[0], org.user_ids["alice"]
        slug = f"agent-{uuid4().hex[:12]}"

        from sqlalchemy.ext.asyncio import AsyncSession

        original_add = AsyncSession.add

        def failing_add(self, instance, *args, **kwargs):
            if isinstance(instance, AgentAccessDBE):
                raise RuntimeError("access insert failed")
            return original_add(self, instance, *args, **kwargs)

        monkeypatch.setattr(AsyncSession, "add", failing_add)

        with pytest.raises(AgentCreationFailed):
            await _dao().create_agent_artifact(
                project_id=project_id,
                user_id=alice,
                artifact_create=ArtifactCreate(slug=slug, name="Alice's agent"),
                access=_private(alice),
            )

        monkeypatch.setattr(AsyncSession, "add", original_add)
        assert await _artifacts_with_slug(project_id, slug) == []


async def test_slug_conflict_passes_through():
    async with seeded("alice") as org:
        project_id, alice = org.project_ids[0], org.user_ids["alice"]
        slug = f"agent-{uuid4().hex[:12]}"
        await _dao().create_artifact(
            project_id=project_id,
            user_id=alice,
            artifact_create=ArtifactCreate(slug=slug, name="first"),
        )

        with pytest.raises(EntityCreationConflict):
            await _dao().create_agent_artifact(
                project_id=project_id,
                user_id=alice,
                artifact_create=ArtifactCreate(slug=slug, name="second"),
                access=_private(alice),
            )

        rows = await _artifacts_with_slug(project_id, slug)
        assert len(rows) == 1
        assert await _access_rows(project_id, rows[0]["id"]) == []


async def test_private_agent_row_and_artifact_committed_together():
    async with seeded("alice") as org:
        project_id, alice = org.project_ids[0], org.user_ids["alice"]
        slug = f"agent-{uuid4().hex[:12]}"

        artifact = await _dao().create_agent_artifact(
            project_id=project_id,
            user_id=alice,
            artifact_create=ArtifactCreate(slug=slug, name="Alice's agent"),
            access=_private(alice),
        )

        rows = await _artifacts_with_slug(project_id, slug)
        assert [row["id"] for row in rows] == [artifact.id]
        assert await _access_rows(project_id, artifact.id) == [
            {"visibility": "private", "owner_user_id": alice}
        ]
        stored = await fetch_all(
            "SELECT created_by_id FROM agent_access "
            "WHERE project_id = :p AND artifact_id = :a",
            {"p": project_id, "a": artifact.id},
        )
        assert stored == [{"created_by_id": alice}]


async def test_given_artifact_id_is_kept():
    async with seeded("alice") as org:
        project_id, alice = org.project_ids[0], org.user_ids["alice"]
        artifact_id = uuid4()

        artifact = await _dao().create_agent_artifact(
            project_id=project_id,
            user_id=alice,
            artifact_create=ArtifactCreate(slug=f"agent-{artifact_id.hex[:12]}"),
            access=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=alice),
            artifact_id=artifact_id,
        )

        assert artifact.id == artifact_id
        assert await _access_rows(project_id, artifact_id) == [
            {"visibility": "project", "owner_user_id": alice}
        ]


async def test_ownerless_agent_has_no_row():
    async with seeded("alice") as org:
        project_id, alice = org.project_ids[0], org.user_ids["alice"]

        artifact = await _dao().create_artifact(
            project_id=project_id,
            user_id=alice,
            artifact_create=ArtifactCreate(slug=f"agent-{uuid4().hex[:12]}"),
        )

        assert artifact is not None
        assert await _access_rows(project_id, artifact.id) == []


async def test_ensure_first_agent_access_only_first():
    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        dao = _dao()

        # An artifact without a row: its first agent revision creates the row.
        artifact_id = await _bare_artifact(project_id)
        variant_id, _ = await _revision(project_id, artifact_id, is_agent=False)
        _, first = await _revision(
            project_id, artifact_id, is_agent=True, variant_id=variant_id
        )
        assert await dao.ensure_first_agent_access(
            project_id=project_id,
            artifact_id=artifact_id,
            revision_id=first,
            owner_user_id=alice,
        )
        assert await _access_rows(project_id, artifact_id) == [
            {"visibility": "project", "owner_user_id": alice}
        ]

        # A later agent revision changes nothing.
        _, second = await _revision(
            project_id, artifact_id, is_agent=True, variant_id=variant_id
        )
        assert not await dao.ensure_first_agent_access(
            project_id=project_id,
            artifact_id=artifact_id,
            revision_id=second,
            owner_user_id=bob,
        )
        assert await _access_rows(project_id, artifact_id) == [
            {"visibility": "project", "owner_user_id": alice}
        ]

        # An artifact whose earlier revision was already an agent (a legacy,
        # ownerless agent): no row.
        legacy_id = await _bare_artifact(project_id)
        legacy_variant, _ = await _revision(project_id, legacy_id, is_agent=True)
        _, later = await _revision(
            project_id, legacy_id, is_agent=True, variant_id=legacy_variant
        )
        assert not await dao.ensure_first_agent_access(
            project_id=project_id,
            artifact_id=legacy_id,
            revision_id=later,
            owner_user_id=alice,
        )
        assert await _access_rows(project_id, legacy_id) == []


async def test_ensure_first_agent_access_waits_for_the_artifact_lock():
    """A concurrent agent policy write holds the artifact row lock: the insert waits
    for it, and after the writer commits it finds the writer's row and inserts
    nothing. Without the lock the insert would land first and the writer, which read
    "no row", would overwrite it."""

    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        artifact_id = await _bare_artifact(project_id)
        _, revision_id = await _revision(project_id, artifact_id, is_agent=True)

        engine = get_transactions_engine()
        async with engine.transaction() as holder:
            await holder.execute(
                text(
                    "SELECT id FROM workflow_artifacts "
                    "WHERE project_id = :p AND id = :a FOR UPDATE"
                ),
                {"p": project_id, "a": artifact_id},
            )
            ensure = asyncio.create_task(
                _dao().ensure_first_agent_access(
                    project_id=project_id,
                    artifact_id=artifact_id,
                    revision_id=revision_id,
                    owner_user_id=alice,
                )
            )
            await asyncio.sleep(0.5)
            assert not ensure.done(), "the insert did not wait for the artifact lock"

            await holder.execute(
                text(
                    "INSERT INTO agent_access (project_id, artifact_id, visibility, "
                    "owner_user_id) VALUES (:p, :a, 'private', :o)"
                ),
                {"p": project_id, "a": artifact_id, "o": bob},
            )

        assert await ensure is False
        assert await _access_rows(project_id, artifact_id) == [
            {"visibility": "private", "owner_user_id": bob}
        ]


async def test_ensure_first_agent_access_against_set_agent_policy():
    """Both writers race on an artifact without a row. Whatever order the lock gives
    them, the state is one of the two serial orders: either the first-agent row came
    first and the policy write fails with a conflict, or the policy write came first
    and the first-agent insert does nothing."""

    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        for _ in range(5):
            artifact_id = await _bare_artifact(project_id)
            _, revision_id = await _revision(project_id, artifact_id, is_agent=True)

            ensured, written = await asyncio.gather(
                _dao().ensure_first_agent_access(
                    project_id=project_id,
                    artifact_id=artifact_id,
                    revision_id=revision_id,
                    owner_user_id=alice,
                ),
                SharingDAO(engine=get_transactions_engine()).set_agent_policy(
                    project_id=project_id,
                    artifact_id=artifact_id,
                    expected=None,
                    policy=_private(bob),
                    user_id=bob,
                ),
                return_exceptions=True,
            )

            rows = await _access_rows(project_id, artifact_id)
            if isinstance(written, SharingConflict):
                assert ensured is True
                assert rows == [{"visibility": "project", "owner_user_id": alice}]
            else:
                assert not isinstance(written, BaseException), written
                assert ensured is False
                assert rows == [{"visibility": "private", "owner_user_id": bob}]


@pytest.mark.parametrize("order", ["earliest_first", "latest_first", "concurrent"])
async def test_ensure_first_agent_access_two_first_commits(order):
    """Two first agent revisions commit before either call to
    `ensure_first_agent_access`, so each call sees the other revision. Whatever order
    the calls run in, exactly one row is written, owned by the committer of the
    earliest agent revision (by created_at, then id)."""

    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        artifact_id = await _bare_artifact(project_id)
        variant_id, earliest = await _revision(project_id, artifact_id, is_agent=True)
        _, latest = await _revision(
            project_id, artifact_id, is_agent=True, variant_id=variant_id
        )

        def ensure(revision_id, owner_user_id):
            return _dao().ensure_first_agent_access(
                project_id=project_id,
                artifact_id=artifact_id,
                revision_id=revision_id,
                owner_user_id=owner_user_id,
            )

        if order == "earliest_first":
            results = {"alice": await ensure(earliest, alice)}
            results["bob"] = await ensure(latest, bob)
        elif order == "latest_first":
            results = {"bob": await ensure(latest, bob)}
            results["alice"] = await ensure(earliest, alice)
        else:
            alice_result, bob_result = await asyncio.gather(
                ensure(earliest, alice), ensure(latest, bob)
            )
            results = {"alice": alice_result, "bob": bob_result}

        assert results == {"alice": True, "bob": False}
        assert await _access_rows(project_id, artifact_id) == [
            {"visibility": "project", "owner_user_id": alice}
        ]


async def test_ensure_first_agent_access_ownerless_earliest_writes_nothing():
    """The earliest agent revision was committed without an owner (it never calls
    `ensure_first_agent_access`): a later agent revision does not take the agent."""

    async with seeded("alice") as org:
        project_id, alice = org.project_ids[0], org.user_ids["alice"]
        artifact_id = await _bare_artifact(project_id)
        variant_id, _ = await _revision(project_id, artifact_id, is_agent=True)
        _, later = await _revision(
            project_id, artifact_id, is_agent=True, variant_id=variant_id
        )

        assert not await _dao().ensure_first_agent_access(
            project_id=project_id,
            artifact_id=artifact_id,
            revision_id=later,
            owner_user_id=alice,
        )
        assert await _access_rows(project_id, artifact_id) == []


async def test_only_an_agent_artifact_has_sharing():
    """An artifact is an agent when one of its revisions carries `flags.is_agent`. A
    prompt or an evaluator (no such revision) is no agent: `is_agent_artifact` says
    so, and `set_agent_policy` refuses it as unknown."""
    async with seeded("alice") as org:
        project_id = org.project_ids[0]
        alice = org.user_ids["alice"]
        dao = _dao()
        sharing = SharingDAO(engine=get_transactions_engine())

        prompt = await _bare_artifact(project_id)
        await _revision(project_id, prompt, is_agent=False)
        agent = await _bare_artifact(project_id)
        variant_id, _ = await _revision(project_id, agent, is_agent=False)
        await _revision(project_id, agent, is_agent=True, variant_id=variant_id)

        assert await dao.is_agent_artifact(project_id=project_id, artifact_id=agent)
        for artifact_id in (prompt, uuid4()):
            assert not await dao.is_agent_artifact(
                project_id=project_id, artifact_id=artifact_id
            )
        assert not await dao.is_agent_artifact(project_id=uuid4(), artifact_id=agent)

        with pytest.raises(SharedItemNotFound):
            await sharing.set_agent_policy(
                project_id=project_id,
                artifact_id=prompt,
                expected=None,
                policy=_private(alice),
                user_id=alice,
            )
        assert await _access_rows(project_id, prompt) == []

        await sharing.set_agent_policy(
            project_id=project_id,
            artifact_id=agent,
            expected=None,
            policy=_private(alice),
            user_id=alice,
        )
        assert await _access_rows(project_id, agent) == [
            {"visibility": "private", "owner_user_id": alice}
        ]
