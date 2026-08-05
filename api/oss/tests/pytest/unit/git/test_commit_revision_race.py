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
from contextlib import asynccontextmanager
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from oss.src.core.git.types import CommitLockTimeout, RevisionConflict
from oss.src.dbs.postgres.shared.engine import TransactionsEngine
from oss.src.utils.env import env


pytestmark = pytest.mark.integration


REVISIONS = "workflow_revisions"
VARIANTS = "workflow_variants"
ARTIFACTS = "workflow_artifacts"


@pytest.fixture
async def engine():
    """One engine per test, built on the loop the test runs on.

    The process-wide engine is a singleton. Its connections belong to the loop that first
    created it, and pytest gives each test a new loop, so reusing it raises "attached to a
    different loop" as soon as any other test in the worker touched the database first.
    """
    instance = TransactionsEngine()
    try:
        yield instance
    finally:
        await instance.close()


async def _exec(engine, sql, params=None):
    async with engine.session() as session:
        result = await session.execute(text(sql), params or {})
        return result


async def _existing_project_id(engine):
    """A project that already exists in the target database, or None.

    Every workflow table has a foreign key to `projects`, so an invented project id fails
    the insert. This fixture attaches to a project instead of creating one. Creating one
    is not portable: on EE a project also requires an organization and a workspace, and
    seeding that chain would write rows outside the tables this test cleans up.
    """
    result = await _exec(
        engine,
        "SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1",
    )
    return result.scalar_one_or_none()


@pytest.fixture
async def variant(engine):
    """An artifact and a variant to race on, removed afterwards.

    The project is borrowed and never deleted. Teardown removes only the rows this
    fixture inserted.
    """
    project_id = await _existing_project_id(engine)
    if project_id is None:
        pytest.skip("no project in the target database to attach the fixture to")

    artifact_id, variant_id = uuid4(), uuid4()
    await _exec(
        engine,
        f"INSERT INTO {ARTIFACTS} (id, project_id, slug, created_at) "
        "VALUES (:id, :project_id, :slug, now())",
        {"id": artifact_id, "project_id": project_id, "slug": f"a-{artifact_id.hex}"},
    )
    await _exec(
        engine,
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
        await _exec(
            engine, f"DELETE FROM {table} WHERE {column} = :target", {"target": target}
        )


async def _seed_head(engine, variant) -> UUID:
    revision_id = uuid4()
    await _exec(
        engine,
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


def _dao(engine):
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
        engine=engine,
    )


def _commit_for(variant):
    from oss.src.core.git.dtos import RevisionCommit

    slug = uuid4().hex[-12:]
    return RevisionCommit(
        slug=slug,
        variant_id=variant["id"],
        artifact_id=variant["artifact_id"],
    )


async def _attempt(engine, variant, expected_head):
    """One writer. Each runs in its own task, so it gets its own scoped session."""
    try:
        revision = await _dao(engine).commit_revision(
            project_id=variant["project_id"],
            user_id=uuid4(),
            revision_commit=_commit_for(variant),
            expected_head_revision_id=expected_head,
        )
        return ("committed", revision)
    except RevisionConflict as e:
        return ("conflict", e)


async def _revision_count(engine, variant) -> int:
    result = await _exec(
        engine,
        f"SELECT count(*) FROM {REVISIONS} WHERE variant_id = :variant_id",
        {"variant_id": variant["id"]},
    )
    return result.scalar_one()


class TestTwoWriters:
    async def test_exactly_one_writer_wins(self, engine, variant):
        head = await _seed_head(engine, variant)

        # Both writers read the SAME head, then commit concurrently. The session is scoped
        # to the running task, so two tasks means two sessions and two connections.
        first, second = await asyncio.gather(
            _attempt(engine, variant, head),
            _attempt(engine, variant, head),
            return_exceptions=False,
        )

        outcomes = sorted([first[0], second[0]])
        assert outcomes == ["committed", "conflict"], (
            f"expected exactly one winner, got {outcomes}"
        )

    async def test_the_loser_is_told_the_new_head(self, engine, variant):
        head = await _seed_head(engine, variant)

        results = await asyncio.gather(
            _attempt(engine, variant, head), _attempt(engine, variant, head)
        )
        winner = next(r for r in results if r[0] == "committed")[1]
        conflict = next(r for r in results if r[0] == "conflict")[1]

        # The loser must be able to re-read and retry in one step, so the error names the
        # revision that actually won.
        assert conflict.expected_head_revision_id == str(head)
        assert conflict.current_head_revision_id == str(winner.id)

    async def test_only_one_revision_lands(self, engine, variant):
        head = await _seed_head(engine, variant)
        before = await _revision_count(engine, variant)

        await asyncio.gather(
            _attempt(engine, variant, head), _attempt(engine, variant, head)
        )

        # The count is the real proof: a lost update would show two.
        assert await _revision_count(engine, variant) == before + 1

    async def test_repeated_races_never_double_commit(self, engine, variant):
        # One pass can pass by luck of scheduling. Ten cannot.
        head = await _seed_head(engine, variant)
        for _ in range(10):
            before = await _revision_count(engine, variant)
            results = await asyncio.gather(
                _attempt(engine, variant, head), _attempt(engine, variant, head)
            )
            assert await _revision_count(engine, variant) == before + 1
            head = next(r for r in results if r[0] == "committed")[1].id


@asynccontextmanager
async def _variant_row_locked(variant):
    """Hold `SELECT ... FOR UPDATE` on the variant row from a separate connection.

    A separate connection is the point. The session the DAO uses is scoped to the running
    task, so a lock taken through it would be the same transaction and would not block.
    """
    import asyncpg

    dsn = env.postgres.uri_core.replace("postgresql+asyncpg://", "postgresql://")
    connection = await asyncpg.connect(dsn)
    transaction = connection.transaction()
    await transaction.start()
    try:
        await connection.execute(
            f"SELECT id FROM {VARIANTS} WHERE id = $1 FOR UPDATE", variant["id"]
        )
        yield
    finally:
        await transaction.rollback()
        await connection.close()


class TestLockTimeout:
    async def test_a_held_lock_makes_the_commit_fail_loudly(self, engine, variant):
        """The bounded wait, executed by a real PostgreSQL server.

        The unit test beside this one asserts the shape of the statement. Only this one
        runs it. `SET LOCAL lock_timeout` rejects a bind parameter, so the statement has
        to interpolate its value, and a test that never reaches a real server cannot tell
        the two forms apart. That gap let a broken statement pass every test while it
        failed on every live commit.

        The 503 that a caller sees is mapped from `CommitLockTimeout` in
        `test_commit_endpoint.py`. This cell proves the exception is raised at all.
        """
        head = await _seed_head(engine, variant)
        before = await _revision_count(engine, variant)

        with patch.object(env.postgres, "commit_lock_timeout_ms", 250):
            async with _variant_row_locked(variant):
                with pytest.raises(CommitLockTimeout):
                    await _dao(engine).commit_revision(
                        project_id=variant["project_id"],
                        user_id=uuid4(),
                        revision_commit=_commit_for(variant),
                        expected_head_revision_id=head,
                    )

        # The wait ended in a refusal, not in a write.
        assert await _revision_count(engine, variant) == before

    async def test_the_same_commit_succeeds_once_the_lock_is_free(
        self, engine, variant
    ):
        # The timeout must not leave the variant unusable. This is the retry the 503 tells
        # the caller to make.
        head = await _seed_head(engine, variant)

        with patch.object(env.postgres, "commit_lock_timeout_ms", 250):
            async with _variant_row_locked(variant):
                with pytest.raises(CommitLockTimeout):
                    await _dao(engine).commit_revision(
                        project_id=variant["project_id"],
                        user_id=uuid4(),
                        revision_commit=_commit_for(variant),
                        expected_head_revision_id=head,
                    )

            status, revision = await _attempt(engine, variant, head)

        assert status == "committed"
        assert revision is not None


class TestSequentialStaleBase:
    async def test_a_second_commit_on_the_old_head_is_refused(self, engine, variant):
        head = await _seed_head(engine, variant)

        status, revision = await _attempt(engine, variant, head)
        assert status == "committed"

        status, error = await _attempt(engine, variant, head)
        assert status == "conflict"
        assert error.current_head_revision_id == str(revision.id)

    async def test_committing_on_the_new_head_succeeds(self, engine, variant):
        head = await _seed_head(engine, variant)
        _, first = await _attempt(engine, variant, head)
        status, _ = await _attempt(engine, variant, first.id)
        assert status == "committed"

    async def test_an_expectation_against_an_empty_variant_conflicts(
        self, engine, variant
    ):
        # No head at all: the caller read a revision this variant does not have.
        status, error = await _attempt(engine, variant, uuid4())
        assert status == "conflict"
        assert error.current_head_revision_id is None
        assert await _revision_count(engine, variant) == 0
