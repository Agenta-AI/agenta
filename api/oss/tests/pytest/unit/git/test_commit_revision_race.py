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

from oss.src.core.git.types import (
    CommitLockTimeout,
    RevisionConflict,
    RevisionUnchanged,
)
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


async def _attempt(engine, variant, expected_head, gate=None):
    """One writer. Each runs in its own task, so it gets its own scoped session.

    ``gate`` makes the overlap deterministic. Both writers wait on it and are released
    together, so the race is real on a fast machine and on a slow one. Without it the
    first writer can finish before the second starts, and the test then passes without
    ever exercising the lock.
    """
    if gate is not None:
        await gate.wait()
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


async def _race(engine, variant, head):
    """Two writers on one head, released together."""
    gate = asyncio.Event()
    writers = asyncio.gather(
        _attempt(engine, variant, head, gate),
        _attempt(engine, variant, head, gate),
        return_exceptions=False,
    )
    # Both tasks are parked on the gate before either touches the database.
    await asyncio.sleep(0)
    gate.set()
    return await writers


class TestTwoWriters:
    async def test_exactly_one_writer_wins(self, engine, variant):
        head = await _seed_head(engine, variant)

        # Both writers read the SAME head, then commit concurrently. The session is scoped
        # to the running task, so two tasks means two sessions and two connections.
        first, second = await _race(engine, variant, head)

        outcomes = sorted([first[0], second[0]])
        assert outcomes == ["committed", "conflict"], (
            f"expected exactly one winner, got {outcomes}"
        )

    async def test_the_loser_is_told_the_new_head(self, engine, variant):
        head = await _seed_head(engine, variant)

        results = await _race(engine, variant, head)
        winner = next(r for r in results if r[0] == "committed")[1]
        conflict = next(r for r in results if r[0] == "conflict")[1]

        # The loser must be able to re-read and retry in one step, so the error names the
        # revision that actually won.
        assert conflict.expected_head_revision_id == str(head)
        assert conflict.current_head_revision_id == str(winner.id)

    async def test_only_one_revision_lands(self, engine, variant):
        head = await _seed_head(engine, variant)
        before = await _revision_count(engine, variant)

        await _race(engine, variant, head)

        # The count is the real proof: a lost update would show two.
        assert await _revision_count(engine, variant) == before + 1

    async def test_repeated_races_never_double_commit(self, engine, variant):
        # One pass can pass by luck of scheduling. Ten cannot.
        head = await _seed_head(engine, variant)
        for _ in range(10):
            before = await _revision_count(engine, variant)
            results = await _race(engine, variant, head)
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


# --------------------------------------------------------------------------------------
# The no-change decision, under the same lock as the insert
# --------------------------------------------------------------------------------------


def _commit_with_data(variant, data):
    from oss.src.core.git.dtos import RevisionCommit

    return RevisionCommit(
        slug=uuid4().hex[-12:],
        variant_id=variant["id"],
        artifact_id=variant["artifact_id"],
        data=data,
    )


async def _insert_revision(engine, variant, data):
    """Another writer's commit, through the DAO, so the row is shaped like a real one."""
    return await _dao(engine).commit_revision(
        project_id=variant["project_id"],
        user_id=uuid4(),
        revision_commit=_commit_with_data(variant, data),
    )


def _unchanged_when(data):
    """The comparison a caller hands down: does the head already hold this?"""

    def check(stored_head):
        return stored_head is not None and stored_head.data == data

    return check


class TestTheNoChangeDecisionIsTakenUnderTheLock:
    """A no-change answer decided BEFORE the lock is an answer about a head that can move.

    The wrapper used to compare in its own transaction and return early, which skipped the
    locked region entirely. Two writers could both pass that comparison, and a caller whose
    base had already moved was told `no_change` instead of being told to re-read. These
    cells pin the decision to the same transaction as the insert.
    """

    async def test_the_comparison_sees_a_write_that_landed_while_it_waited(
        self, engine, variant
    ):
        # The decisive one. Another connection holds the variant lock and inserts a
        # revision while this commit waits for it. The candidate equals what the OTHER
        # writer stored, and differs from the head this caller could have read before
        # blocking. A comparison made before the lock would not see that row and would
        # insert a duplicate; one made after it answers `unchanged`.
        import asyncpg

        await _insert_revision(engine, variant, {"stage": "old"})
        before = await _revision_count(engine, variant)

        dsn = env.postgres.uri_core.replace("postgresql+asyncpg://", "postgresql://")
        blocker = await asyncpg.connect(dsn)
        transaction = blocker.transaction()
        await transaction.start()
        await blocker.execute(
            f"SELECT id FROM {VARIANTS} WHERE id = $1 FOR UPDATE", variant["id"]
        )

        async def commit_while_blocked():
            return await _dao(engine).commit_revision(
                project_id=variant["project_id"],
                user_id=uuid4(),
                revision_commit=_commit_with_data(variant, {"stage": "new"}),
                no_change_check=_unchanged_when({"stage": "new"}),
            )

        waiter = asyncio.create_task(commit_while_blocked())
        # Long enough that the waiter is parked on the lock, not merely scheduled.
        await asyncio.sleep(0.3)
        assert not waiter.done(), "the commit did not wait for the variant lock"

        # The other writer's row lands, then the lock is released.
        new_id = uuid4()
        await blocker.execute(
            f"INSERT INTO {REVISIONS} "
            "(id, project_id, artifact_id, variant_id, slug, created_at, author, date, data) "
            "VALUES ($1, $2, $3, $4, $5, now(), $6, now(), $7)",
            new_id,
            variant["project_id"],
            variant["artifact_id"],
            variant["id"],
            f"r-{new_id.hex}",
            uuid4(),
            '{"stage": "new"}',
        )
        await transaction.commit()
        await blocker.close()

        with pytest.raises(RevisionUnchanged) as caught:
            await waiter

        assert caught.value.head_revision_id == new_id
        # One row landed, and it is the other writer's. A pre-lock comparison would have
        # added a second one holding the identical configuration.
        assert await _revision_count(engine, variant) == before + 1

    async def test_a_moved_head_beats_a_no_change_answer(self, engine, variant):
        # The precedence rule (commit-transaction.md 6, rule 2 over rule 6). This caller is
        # stale AND its result happens to equal the new head, which is the case that makes
        # the ordering matter: answering `no_change` would confirm a base that had moved.
        head = await _insert_revision(engine, variant, {"stage": "old"})
        await _insert_revision(engine, variant, {"stage": "new"})
        before = await _revision_count(engine, variant)

        with pytest.raises(RevisionConflict):
            await _dao(engine).commit_revision(
                project_id=variant["project_id"],
                user_id=uuid4(),
                revision_commit=_commit_with_data(variant, {"stage": "new"}),
                expected_head_revision_id=head.id,
                no_change_check=_unchanged_when({"stage": "new"}),
            )

        assert await _revision_count(engine, variant) == before

    async def test_an_unchanged_commit_on_a_current_base_writes_nothing(
        self, engine, variant
    ):
        head = await _insert_revision(engine, variant, {"stage": "same"})
        before = await _revision_count(engine, variant)

        with pytest.raises(RevisionUnchanged) as caught:
            await _dao(engine).commit_revision(
                project_id=variant["project_id"],
                user_id=uuid4(),
                revision_commit=_commit_with_data(variant, {"stage": "same"}),
                expected_head_revision_id=head.id,
                no_change_check=_unchanged_when({"stage": "same"}),
            )

        assert caught.value.head_revision_id == head.id
        assert await _revision_count(engine, variant) == before

    async def test_a_real_change_still_commits_under_the_same_check(
        self, engine, variant
    ):
        head = await _insert_revision(engine, variant, {"stage": "old"})
        before = await _revision_count(engine, variant)

        revision = await _dao(engine).commit_revision(
            project_id=variant["project_id"],
            user_id=uuid4(),
            revision_commit=_commit_with_data(variant, {"stage": "new"}),
            expected_head_revision_id=head.id,
            no_change_check=_unchanged_when({"stage": "new"}),
        )

        assert revision is not None
        assert await _revision_count(engine, variant) == before + 1

    async def test_a_variant_with_no_head_is_never_unchanged(self, engine, variant):
        # Nothing stored cannot equal what is being stored. The first commit must land.
        revision = await _dao(engine).commit_revision(
            project_id=variant["project_id"],
            user_id=uuid4(),
            revision_commit=_commit_with_data(variant, {"stage": "first"}),
            no_change_check=_unchanged_when({"stage": "first"}),
        )

        assert revision is not None
        assert await _revision_count(engine, variant) == 1
