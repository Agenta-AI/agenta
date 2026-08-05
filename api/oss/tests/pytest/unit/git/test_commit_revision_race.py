"""The two-writer race, against a real Postgres (slice S1b-lock).

The unit tests beside this file prove the DECISION: given a head that moved, the DAO
refuses. They cannot prove the mechanism, because their sessions are fakes and their calls
are sequential. Only a real database with two live connections can show that
`SELECT ... FOR UPDATE` actually blocks the second writer until the first commits, and
that the second's re-read then sees the first's insert.

That is the whole point of the lock, so it needs a test that would fail if the lock were
removed. Removing `with_for_update()` makes `test_exactly_one_writer_wins` flaky-to-failing
rather than green.

Runs where Postgres exists; skipped otherwise by the conftest probe beside this file.
"""

import asyncio
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from oss.src.core.git.types import RevisionConflict
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


pytestmark = pytest.mark.integration


REVISIONS = "workflow_revisions"
VARIANTS = "workflow_variants"
ARTIFACTS = "workflow_artifacts"


async def _exec(sql, params=None):
    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(text(sql), params or {})
        return result


@pytest.fixture
async def variant():
    """A project, artifact, and variant to race on, removed afterwards."""
    project_id, artifact_id, variant_id = uuid4(), uuid4(), uuid4()
    await _exec(
        f"INSERT INTO {ARTIFACTS} (id, project_id, slug, created_at) "
        "VALUES (:id, :project_id, :slug, now())",
        {"id": artifact_id, "project_id": project_id, "slug": f"a-{artifact_id.hex}"},
    )
    await _exec(
        f"INSERT INTO {VARIANTS} (id, project_id, artifact_id, slug, created_at) "
        "VALUES (:id, :project_id, :artifact_id, :slug, now())",
        {
            "id": variant_id,
            "project_id": project_id,
            "artifact_id": artifact_id,
            "slug": f"v-{variant_id.hex}",
        },
    )
    yield {"project_id": project_id, "artifact_id": artifact_id, "id": variant_id}
    for table, column in (
        (REVISIONS, "variant_id"),
        (VARIANTS, "id"),
        (ARTIFACTS, "id"),
    ):
        target = variant_id if column == "variant_id" else None
        if table == VARIANTS:
            target = variant_id
        elif table == ARTIFACTS:
            target = artifact_id
        await _exec(f"DELETE FROM {table} WHERE {column} = :target", {"target": target})


async def _seed_head(variant) -> UUID:
    revision_id = uuid4()
    await _exec(
        f"INSERT INTO {REVISIONS} "
        "(id, project_id, artifact_id, variant_id, slug, created_at, author, date) "
        "VALUES (:id, :project_id, :artifact_id, :variant_id, :slug, now(), :author, now())",
        {
            "id": revision_id,
            "project_id": variant["project_id"],
            "artifact_id": variant["artifact_id"],
            "variant_id": variant["id"],
            "slug": f"r-{revision_id.hex}",
            "author": uuid4(),
        },
    )
    return revision_id


def _dao():
    import oss.src.models.db_models  # noqa: F401  (registers `projects` for the FKs)
    from oss.src.dbs.postgres.git.dao import GitDAO
    from oss.src.dbs.postgres.workflows.dbes import (
        WorkflowArtifactDBE,
        WorkflowRevisionDBE,
        WorkflowVariantDBE,
    )

    return GitDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
    )


def _commit_for(variant):
    from oss.src.core.git.dtos import RevisionCommit

    slug = uuid4().hex[-12:]
    return RevisionCommit(
        slug=slug,
        variant_id=variant["id"],
        artifact_id=variant["artifact_id"],
    )


async def _attempt(variant, expected_head):
    """One writer. Each runs in its own task, so it gets its own scoped session."""
    try:
        revision = await _dao().commit_revision(
            project_id=variant["project_id"],
            user_id=uuid4(),
            revision_commit=_commit_for(variant),
            expected_head_revision_id=expected_head,
        )
        return ("committed", revision)
    except RevisionConflict as e:
        return ("conflict", e)


async def _revision_count(variant) -> int:
    result = await _exec(
        f"SELECT count(*) FROM {REVISIONS} WHERE variant_id = :variant_id",
        {"variant_id": variant["id"]},
    )
    return result.scalar_one()


class TestTwoWriters:
    async def test_exactly_one_writer_wins(self, variant):
        head = await _seed_head(variant)

        # Both writers read the SAME head, then commit concurrently. The session is scoped
        # to the running task, so two tasks means two sessions and two connections.
        first, second = await asyncio.gather(
            _attempt(variant, head),
            _attempt(variant, head),
            return_exceptions=False,
        )

        outcomes = sorted([first[0], second[0]])
        assert outcomes == ["committed", "conflict"], (
            f"expected exactly one winner, got {outcomes}"
        )

    async def test_the_loser_is_told_the_new_head(self, variant):
        head = await _seed_head(variant)

        results = await asyncio.gather(_attempt(variant, head), _attempt(variant, head))
        winner = next(r for r in results if r[0] == "committed")[1]
        conflict = next(r for r in results if r[0] == "conflict")[1]

        # The loser must be able to re-read and retry in one step, so the error names the
        # revision that actually won.
        assert conflict.expected_head_revision_id == str(head)
        assert conflict.current_head_revision_id == str(winner.id)

    async def test_only_one_revision_lands(self, variant):
        head = await _seed_head(variant)
        before = await _revision_count(variant)

        await asyncio.gather(_attempt(variant, head), _attempt(variant, head))

        # The count is the real proof: a lost update would show two.
        assert await _revision_count(variant) == before + 1

    async def test_repeated_races_never_double_commit(self, variant):
        # One pass can pass by luck of scheduling. Ten cannot.
        head = await _seed_head(variant)
        for _ in range(10):
            before = await _revision_count(variant)
            results = await asyncio.gather(
                _attempt(variant, head), _attempt(variant, head)
            )
            assert await _revision_count(variant) == before + 1
            head = next(r for r in results if r[0] == "committed")[1].id


class TestSequentialStaleBase:
    async def test_a_second_commit_on_the_old_head_is_refused(self, variant):
        head = await _seed_head(variant)

        status, revision = await _attempt(variant, head)
        assert status == "committed"

        status, error = await _attempt(variant, head)
        assert status == "conflict"
        assert error.current_head_revision_id == str(revision.id)

    async def test_committing_on_the_new_head_succeeds(self, variant):
        head = await _seed_head(variant)
        _, first = await _attempt(variant, head)
        status, _ = await _attempt(variant, first.id)
        assert status == "committed"

    async def test_an_expectation_against_an_empty_variant_conflicts(self, variant):
        # No head at all: the caller read a revision this variant does not have.
        status, error = await _attempt(variant, uuid4())
        assert status == "conflict"
        assert error.current_head_revision_id is None
        assert await _revision_count(variant) == 0
