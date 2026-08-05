"""The variant lock on a checked commit (slice S1b-lock).

`commit_revision` gains `expected_head_revision_id`. When it is set, the DAO locks the
variant row, re-reads the head under that lock, and refuses when the head moved.

The re-read is the point. A comparison the CALLER made before calling is not enough: two
writers can both read head N, both pass their own check, and both insert. Only a read
taken while holding the lock can see the other writer's insert.

These tests drive the ordering logic with a fake session, so they run in the unit suite
with no database. The two-writer test against real Postgres lives in the integration
suite and is named in docs/design/agent-config-editing/notes/dao-lock-impact.md.
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.git.types import (
    CommitLockTimeout,
    InitialRevisionConflict,
    RevisionConflict,
    VariantNotFound,
)


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value

    def scalar_one_or_none(self):
        return self._value


class _DriverError(Exception):
    """A driver error carrying a SQLSTATE, the way asyncpg reports one."""

    def __init__(self, sqlstate):
        super().__init__(f"driver error {sqlstate}")
        self.sqlstate = sqlstate


class _WrappedDriverError(Exception):
    """What SQLAlchemy raises: its own error with the driver's on `.orig`."""

    def __init__(self, sqlstate):
        super().__init__("statement failed")
        self.orig = _DriverError(sqlstate)


class _FakeSession:
    """Records the statements a commit issues, in order, and answers the guards."""

    def __init__(
        self,
        *,
        revision_count=0,
        head_id=None,
        variant_exists=True,
        lock_error=None,
    ):
        self.revision_count = revision_count
        self.head_id = head_id
        self.variant_exists = variant_exists
        self.lock_error = lock_error
        self.executed = []
        self.added = []
        self.committed = False

    async def execute(self, statement):
        text = str(statement)
        self.executed.append(text)
        if "FOR UPDATE" in text:
            if self.lock_error is not None:
                raise self.lock_error
            return _Result(object() if self.variant_exists else None)
        if "count(" in text.lower():
            return _Result(self.revision_count)
        return _Result(self.head_id)

    def add(self, entity):
        self.added.append(entity)

    async def commit(self):
        self.committed = True

    async def refresh(self, entity, attribute_names=None):
        return None

    async def close(self):
        return None

    async def rollback(self):
        return None


def _took_the_lock(session):
    return any("FOR UPDATE" in statement for statement in session.executed)


def _lock_came_first(session):
    """The lock must precede every guard read, or the guard reads unprotected state."""
    lock_at = next(
        (i for i, s in enumerate(session.executed) if "FOR UPDATE" in s), None
    )
    if lock_at is None:
        return False
    return all(
        lock_at < i
        for i, s in enumerate(session.executed)
        if "FOR UPDATE" not in s and ("count(" in s.lower() or "ORDER BY" in s)
    )


@pytest.fixture
def dao_factory(monkeypatch):
    """A GitDAO whose engine hands out one fake session."""
    # Importing the project model registers the `projects` table the workflow DBEs'
    # foreign keys resolve against; without it, compiling any statement fails.
    import oss.src.models.db_models  # noqa: F401
    from oss.src.dbs.postgres.git.dao import GitDAO
    from oss.src.dbs.postgres.workflows.dbes import (
        WorkflowArtifactDBE,
        WorkflowRevisionDBE,
        WorkflowVariantDBE,
    )

    def _build(session):
        dao = GitDAO(
            ArtifactDBE=WorkflowArtifactDBE,
            VariantDBE=WorkflowVariantDBE,
            RevisionDBE=WorkflowRevisionDBE,
        )

        @asynccontextmanager
        async def _session():
            yield session

        dao.engine = SimpleNamespace(session=_session)

        # The post-insert version bookkeeping opens further sessions and runs real
        # queries. It is not what these tests exercise, and leaving it live would make
        # them assert on the fake's query coverage instead of on the lock ordering.
        async def _version(*args, **kwargs):
            return "1"

        async def _noop(*args, **kwargs):
            return None

        dao._get_version = _version
        dao._set_version = _noop
        dao._null_revision_fields = _noop
        return dao

    return _build


def _commit(variant_id=None, **kwargs):
    from oss.src.core.git.dtos import RevisionCommit

    return RevisionCommit(
        slug="rev-slug",
        variant_id=variant_id or uuid4(),
        artifact_id=uuid4(),
        **kwargs,
    )


class TestLockCondition:
    async def test_an_unchecked_commit_takes_no_lock(self, dao_factory):
        # Today's behavior for every existing caller: no expectation, no lock, no change
        # in cost or in contention.
        session = _FakeSession()
        dao = dao_factory(session)
        await dao.commit_revision(
            project_id=uuid4(), user_id=uuid4(), revision_commit=_commit()
        )
        assert not _took_the_lock(session)
        assert session.added

    async def test_an_initial_commit_still_takes_the_lock(self, dao_factory):
        session = _FakeSession(revision_count=0)
        dao = dao_factory(session)
        await dao.commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=_commit(),
            initial=True,
        )
        assert _took_the_lock(session)
        assert _lock_came_first(session)

    async def test_a_checked_commit_takes_the_lock(self, dao_factory):
        head = uuid4()
        session = _FakeSession(head_id=head)
        dao = dao_factory(session)
        await dao.commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=_commit(),
            expected_head_revision_id=head,
        )
        assert _took_the_lock(session)
        assert _lock_came_first(session)

    async def test_the_head_is_read_under_the_lock_not_before(self, dao_factory):
        # If the head read came first, the check would race exactly like a caller-side
        # comparison does.
        session = _FakeSession(head_id=uuid4())
        dao = dao_factory(session)
        with pytest.raises(RevisionConflict):
            await dao.commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
                expected_head_revision_id=uuid4(),
            )
        assert _lock_came_first(session)


class TestConflict:
    async def test_a_moved_head_refuses_and_inserts_nothing(self, dao_factory):
        expected, actual = uuid4(), uuid4()
        session = _FakeSession(head_id=actual)
        dao = dao_factory(session)
        with pytest.raises(RevisionConflict) as caught:
            await dao.commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
                expected_head_revision_id=expected,
            )
        assert caught.value.expected_head_revision_id == str(expected)
        assert caught.value.current_head_revision_id == str(actual)
        assert session.added == []
        assert session.committed is False

    async def test_a_matching_head_commits(self, dao_factory):
        head = uuid4()
        session = _FakeSession(head_id=head)
        dao = dao_factory(session)
        revision = await dao.commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=_commit(),
            expected_head_revision_id=head,
        )
        assert revision is not None
        assert session.added

    async def test_an_absent_head_conflicts_with_any_expectation(self, dao_factory):
        # Exact equality, absence included. An expectation against a variant with no head
        # means the caller read a revision this variant does not have, so accepting it
        # would let a commit land on a base that never existed here.
        session = _FakeSession(head_id=None)
        dao = dao_factory(session)
        with pytest.raises(RevisionConflict) as caught:
            await dao.commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
                expected_head_revision_id=uuid4(),
            )
        assert caught.value.current_head_revision_id is None
        assert session.added == []

    async def test_a_fresh_variant_commits_without_an_expectation(self, dao_factory):
        # The first commit on a fresh variant has nothing to expect, so it passes none.
        session = _FakeSession(head_id=None)
        dao = dao_factory(session)
        revision = await dao.commit_revision(
            project_id=uuid4(), user_id=uuid4(), revision_commit=_commit()
        )
        assert revision is not None

    async def test_the_conflict_is_not_swallowed_by_suppression(self, dao_factory):
        # `commit_revision` is wrapped in `suppress_exceptions`. Without the exclude, a
        # conflict would return None and the caller would report "nothing committed" with
        # no reason. This test is the whole reason the exclude list grew.
        session = _FakeSession(head_id=uuid4())
        dao = dao_factory(session)
        with pytest.raises(RevisionConflict):
            await dao.commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
                expected_head_revision_id=uuid4(),
            )

    async def test_the_initial_conflict_is_still_not_swallowed(self, dao_factory):
        session = _FakeSession(revision_count=1)
        dao = dao_factory(session)
        with pytest.raises(InitialRevisionConflict):
            await dao.commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
                initial=True,
            )


class TestStaleBase:
    async def test_a_writer_whose_head_moved_is_refused(self, dao_factory):
        """The stale-base branch, driven through the DAO's own ordering.

        This is NOT the race test: the sessions are fakes and the two calls are
        sequential, so it proves the decision, not the blocking. The real two-connection
        race lives in
        `api/oss/tests/pytest/integration/git/test_commit_revision_race.py`.
        """
        head_n, head_n1 = uuid4(), uuid4()

        winner = _FakeSession(head_id=head_n)
        committed = await dao_factory(winner).commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=_commit(),
            expected_head_revision_id=head_n,
        )
        assert committed is not None

        loser = _FakeSession(head_id=head_n1)
        with pytest.raises(RevisionConflict) as caught:
            await dao_factory(loser).commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
                expected_head_revision_id=head_n,
            )
        assert caught.value.current_head_revision_id == str(head_n1)
        assert loser.added == []


class TestBoundedWait:
    async def test_the_lock_wait_is_bounded(self, dao_factory):
        # An unbounded FOR UPDATE lets one stuck holder pin a connection for the whole
        # pool. The timeout must be set before the lock is taken, or it does not apply.
        session = _FakeSession(head_id=None)
        dao = dao_factory(session)
        await dao.commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=_commit(),
            initial=True,
        )
        timeout_at = next(
            (i for i, s in enumerate(session.executed) if "lock_timeout" in s), None
        )
        lock_at = next(
            (i for i, s in enumerate(session.executed) if "FOR UPDATE" in s), None
        )
        assert timeout_at is not None
        assert lock_at is not None
        assert timeout_at < lock_at
        # Postgres rejects bind parameters in SET LOCAL (syntax error at "$1"), so the
        # timeout must be an inline literal. A ":param" placeholder here means the
        # statement fails on a real database while every fake-session test stays green.
        assert ":" not in session.executed[timeout_at]
        assert "ms'" in session.executed[timeout_at]

    async def test_an_unchecked_commit_sets_no_timeout(self, dao_factory):
        session = _FakeSession()
        await dao_factory(session).commit_revision(
            project_id=uuid4(), user_id=uuid4(), revision_commit=_commit()
        )
        assert not any("lock_timeout" in s for s in session.executed)

    async def test_an_expired_wait_fails_loudly(self, dao_factory):
        # The whole point of the bounded wait. Suppression would turn the timeout into
        # `None`, which the commit wrapper reports as `status="committed", count: 0` — a
        # successful empty commit for a commit that never happened.
        head = uuid4()
        session = _FakeSession(head_id=head, lock_error=_WrappedDriverError("55P03"))
        dao = dao_factory(session)
        with pytest.raises(CommitLockTimeout):
            await dao.commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
                expected_head_revision_id=head,
            )
        assert session.added == []

    async def test_a_bare_driver_timeout_is_translated_too(self, dao_factory):
        # The SQLSTATE can arrive on the driver error itself rather than on a wrapper, so
        # the translation walks the chain instead of trusting one shape.
        session = _FakeSession(head_id=None, lock_error=_DriverError("55P03"))
        with pytest.raises(CommitLockTimeout):
            await dao_factory(session).commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
                initial=True,
            )

    async def test_another_database_error_is_still_suppressed(self, dao_factory):
        # Only the timeout changes. Every other failure keeps today's behavior, so this
        # lane cannot turn an unrelated error into a new exception for existing callers.
        session = _FakeSession(head_id=None, lock_error=_WrappedDriverError("40001"))
        revision = await dao_factory(session).commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=_commit(),
            initial=True,
        )
        assert revision is None


class TestLockedRow:
    async def test_a_missing_variant_refuses_instead_of_committing_unlocked(
        self, dao_factory
    ):
        # `SELECT ... FOR UPDATE` on a row that is missing, or owned by another project,
        # locks nothing and reports nothing. Ignoring that result would run every guard
        # below unprotected and insert a revision against a variant this project has not.
        session = _FakeSession(revision_count=0, variant_exists=False)
        dao = dao_factory(session)
        with pytest.raises(VariantNotFound):
            await dao.commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
                initial=True,
            )
        assert session.added == []
        assert session.committed is False

    async def test_an_unchecked_commit_does_not_assert_the_row(self, dao_factory):
        # It takes no lock, so it has no locked row to assert. Existing callers keep
        # today's behavior exactly.
        session = _FakeSession(variant_exists=False)
        revision = await dao_factory(session).commit_revision(
            project_id=uuid4(), user_id=uuid4(), revision_commit=_commit()
        )
        assert revision is not None
