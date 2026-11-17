"""The drive SQL of the sharing and workflows DAOs on the real database: the share write
of an agent's drives, the own drive compare under the agent lock, and the agents that use
a set of drives (the share disclosure).

Every test seeds its own organization; the organization delete in `finally` cascades to
every row written here.
"""

import json
from contextlib import asynccontextmanager
from typing import Optional
from uuid import UUID, uuid4

import pytest

import oss.src.models.db_models  # noqa: F401  (the ORM tables the DAOs join)
from oss.src.core.sharing.dtos import AccessPolicy, AgentReadScope, Visibility
from oss.src.core.sharing.types import SharingConflict
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.sharing.dao import SharingDAO
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


def _private(user_id: UUID) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=user_id)


def _shared(user_id: Optional[UUID] = None) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=user_id)


async def _agent(
    project_id: UUID,
    *,
    name: str,
    policy: Optional[AccessPolicy] = None,
    agent_config: Optional[dict] = None,
) -> UUID:
    """An agent artifact with one variant and one revision, whose data holds
    `agent_config` as `parameters.agent`."""

    artifact_id, variant_id = uuid4(), uuid4()
    slug = f"agent-{artifact_id.hex[:12]}"
    await execute(
        "INSERT INTO workflow_artifacts (project_id, id, slug, name) "
        "VALUES (:p, :a, :s, :n)",
        {"p": project_id, "a": artifact_id, "s": slug, "n": name},
    )
    await execute(
        "INSERT INTO workflow_variants (project_id, artifact_id, id, slug) "
        "VALUES (:p, :a, :v, :s)",
        {"p": project_id, "a": artifact_id, "v": variant_id, "s": f"{slug}.default"},
    )
    data = {"parameters": {"agent": agent_config or {}}}
    await execute(
        "INSERT INTO workflow_revisions (project_id, artifact_id, variant_id, id, "
        "slug, author, flags, data) VALUES (:p, :a, :v, :r, :s, :p, "
        "CAST('{\"is_agent\": true}' AS jsonb), CAST(:d AS json))",
        {
            "p": project_id,
            "a": artifact_id,
            "v": variant_id,
            "r": uuid4(),
            "s": f"{slug}.r1",
            "d": json.dumps(data),
        },
    )
    if policy is not None:
        await execute(
            "INSERT INTO agent_access (project_id, artifact_id, visibility, "
            "owner_user_id) VALUES (:p, :a, :v, :o)",
            {
                "p": project_id,
                "a": artifact_id,
                "v": policy.visibility.value,
                "o": policy.owner_user_id,
            },
        )
    return artifact_id


async def _variant(artifact_id: UUID, project_id: UUID, *, agent_config: dict):
    variant_id = uuid4()
    await execute(
        "INSERT INTO workflow_variants (project_id, artifact_id, id, slug) "
        "VALUES (:p, :a, :v, :s)",
        {"p": project_id, "a": artifact_id, "v": variant_id, "s": f"v-{variant_id}"},
    )
    await execute(
        "INSERT INTO workflow_revisions (project_id, artifact_id, variant_id, id, "
        "slug, author, flags, data) VALUES (:p, :a, :v, :r, :s, :p, "
        "CAST('{\"is_agent\": true}' AS jsonb), CAST(:d AS json))",
        {
            "p": project_id,
            "a": artifact_id,
            "v": variant_id,
            "r": uuid4(),
            "s": f"r-{variant_id}",
            "d": json.dumps({"parameters": {"agent": agent_config}}),
        },
    )


async def _drive(
    project_id: UUID,
    *,
    slug: str,
    policy: Optional[AccessPolicy] = None,
    agent_id: Optional[UUID] = None,
) -> UUID:
    mount_id = uuid4()
    await execute(
        "INSERT INTO mounts (project_id, id, slug, name, agent_id, storage_prefix) "
        "VALUES (:p, :id, :s, :s, :a, :prefix)",
        {
            "p": project_id,
            "id": mount_id,
            "s": slug,
            "a": str(agent_id) if agent_id is not None else None,
            "prefix": f"test/{mount_id}",
        },
    )
    if policy is not None:
        await execute(
            "INSERT INTO mount_visibility (project_id, mount_id, visibility, "
            "owner_user_id) VALUES (:p, :m, :v, :o)",
            {
                "p": project_id,
                "m": mount_id,
                "v": policy.visibility.value,
                "o": policy.owner_user_id,
            },
        )
    return mount_id


async def _visibility(project_id: UUID, mount_id: UUID):
    rows = await fetch_all(
        "SELECT visibility, owner_user_id FROM mount_visibility "
        "WHERE project_id = :p AND mount_id = :m",
        {"p": project_id, "m": mount_id},
    )
    return (rows[0]["visibility"], rows[0]["owner_user_id"]) if rows else None


def _sharing() -> SharingDAO:
    return SharingDAO(engine=get_transactions_engine())


def _workflows() -> WorkflowsDAO:
    return WorkflowsDAO(
        engine=get_transactions_engine(),
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
    )


async def test_sharing_writes_a_row_for_a_drive_without_one():
    async with seeded("alice") as org:
        project_id = org.project_ids[0]
        alice = org.user_ids["alice"]
        other = await _agent(project_id, name="Other", policy=_private(alice))
        agent = await _agent(project_id, name="Quote", policy=_private(alice))
        legacy = await _drive(project_id, slug="other-files", agent_id=other)
        notes = await _drive(project_id, slug="notes", policy=_private(alice))
        prices = await _drive(project_id, slug="prices", policy=_shared())

        result = await _sharing().set_agent_policy(
            project_id=project_id,
            artifact_id=agent,
            expected=_private(alice),
            policy=_shared(alice),
            user_id=alice,
            share_mount_ids=[legacy, notes, prices],
        )

        assert result.drives_made_shared == ["notes", "other-files"]
        assert await _visibility(project_id, legacy) == ("project", alice)
        assert await _visibility(project_id, notes) == ("project", alice)
        assert await _visibility(project_id, prices) == ("project", None)


async def test_a_changed_own_drive_row_conflicts_under_the_lock():
    async with seeded("alice") as org:
        project_id = org.project_ids[0]
        alice = org.user_ids["alice"]
        agent = await _agent(project_id, name="Quote", policy=_shared(alice))
        await _drive(project_id, slug="quote-files", agent_id=agent)
        assert (
            await _sharing().fetch_own_drive_policy(
                project_id=project_id, artifact_id=agent
            )
            is None
        )
        # A concurrent writer (the release 2 migration) gives the own drive its row.
        own = (
            await fetch_all(
                "SELECT id FROM mounts WHERE project_id = :p AND slug = 'quote-files'",
                {"p": project_id},
            )
        )[0]["id"]
        await execute(
            "INSERT INTO mount_visibility (project_id, mount_id, visibility, "
            "owner_user_id) VALUES (:p, :m, 'project', :o)",
            {"p": project_id, "m": own, "o": alice},
        )

        with pytest.raises(SharingConflict):
            await _sharing().set_agent_policy(
                project_id=project_id,
                artifact_id=agent,
                expected=_shared(alice),
                policy=_private(alice),
                user_id=alice,
                check_own_drive=True,
                expected_own_drive=None,
            )
        assert await _sharing().fetch_own_drive_policy(
            project_id=project_id, artifact_id=agent
        ) == _shared(alice)
        policy = await _sharing().fetch_agent_policy(
            project_id=project_id, artifact_id=agent
        )
        assert policy == _shared(alice)


async def test_the_agents_that_use_a_drive():
    async with seeded("alice", "bob") as org:
        project_id = org.project_ids[0]
        alice, bob = org.user_ids["alice"], org.user_ids["bob"]
        sharer = await _agent(
            project_id,
            name="Sharer",
            policy=_private(alice),
            agent_config={"drives": [{"slug": "notes"}], "home_drive": "notes"},
        )
        await _agent(
            project_id,
            name="Lister",
            policy=_private(alice),
            agent_config={"drives": [{"slug": "notes"}], "home_drive": None},
        )
        await _drive(project_id, slug="notes", policy=_private(alice))
        legacy = await _agent(project_id, name="Legacy", policy=_private(alice))
        await _drive(project_id, slug="legacy-files", agent_id=legacy)
        # Another variant of it states `drives`; its legacy variant still uses the drive.
        await _variant(legacy, project_id, agent_config={"drives": []})
        # A release 1 revision names the legacy drive by its reserved slug.
        await _agent(
            project_id,
            name="Reserved",
            policy=_private(alice),
            agent_config={
                "drives": [{"slug": f"__ag__agent__{legacy}__default"}],
                "home_drive": None,
            },
        )
        await _agent(
            project_id,
            name="Hidden",
            policy=_private(bob),
            agent_config={"drives": [{"slug": "notes"}], "home_drive": None},
        )
        await _agent(
            project_id,
            name="Unrelated",
            agent_config={"drives": [{"slug": "prices"}], "home_drive": None},
        )
        await _agent(project_id, name="Null", agent_config={"drives": None})

        names = await _workflows().fetch_agents_using_drives(
            project_id=project_id,
            artifact_id=sharer,
            slugs=["notes", "legacy-files"],
            read_scope=AgentReadScope(owner_user_id=alice),
        )

        assert names == ["Legacy", "Lister", "Reserved"]
