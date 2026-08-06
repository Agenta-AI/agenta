"""WHICH commits take the variant lock, and which are left exactly as they were.

The lock is not free: it serializes every writer on a variant, and a caller that waits past
`lock_timeout` gets a 503 instead of a commit. So the rule is that a commit takes it only
when a guard needs it, and the claim that the flag-off path behaves byte-for-byte as it did
before this project rests entirely on that path taking no lock at all.

That claim was resting on reading `needs_lock`, not on a test. Reading a condition is how
`SET LOCAL lock_timeout` shipped with a bind parameter through 1911 green tests: the code
looked right and nothing executed it. These cells execute it, by recording the statements
each call actually issues.

The lock's ORDERING and its timeout translation are covered in `test_commit_revision_lock.py`
against the same fake session; the real two-connection behavior is in
`test_commit_revision_race.py` against real Postgres. This file covers only the question of
whether the lock is taken.
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value

    def scalar_one_or_none(self):
        return self._value


class _RecordingSession:
    """Records every statement a commit issues, so the test can ask what it did."""

    def __init__(self, *, head_id=None, head_row=None):
        self.head_id = head_id
        self.head_row = head_row
        self.executed = []
        self.added = []

    async def execute(self, statement):
        rendered = str(statement)
        self.executed.append(rendered)
        if "FOR UPDATE" in rendered:
            return _Result(object())
        if "count(" in rendered.lower():
            return _Result(0)
        # The head re-read selects an id; the no-change read selects the whole row.
        if self.head_row is not None and "workflow_revisions.id," in rendered:
            return _Result(self.head_row)
        return _Result(self.head_id)

    def add(self, entity):
        self.added.append(entity)

    async def commit(self):
        return None

    async def refresh(self, entity, attribute_names=None):
        return None

    async def close(self):
        return None

    async def rollback(self):
        return None


@pytest.fixture
def dao_factory():
    """A GitDAO whose engine hands out one recording session."""
    # Registers the `projects` table the workflow DBEs' foreign keys resolve against;
    # without it, compiling any statement fails.
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

        async def _version(*args, **kwargs):
            return "1"

        async def _noop(*args, **kwargs):
            return None

        dao._get_version = _version
        dao._set_version = _noop
        dao._null_revision_fields = _noop
        return dao

    return _build


def _commit(variant_id):
    from oss.src.core.git.dtos import RevisionCommit

    return RevisionCommit(
        slug=uuid4().hex[-12:],
        variant_id=variant_id,
        artifact_id=uuid4(),
        data={"parameters": {"agent": {"instructions": "hi"}}},
    )


def _took_the_lock(session):
    return any("FOR UPDATE" in statement for statement in session.executed)


def _refuses_nothing(stored_head):
    """A comparison that never answers "unchanged", so the commit runs to the insert."""
    return False


class TestWhichCommitsTakeTheLock:
    async def test_a_plain_commit_takes_no_lock(self, dao_factory):
        # The path every caller outside the checked wrapper takes, including the flag-off
        # commit path. Serializing them would be a behavior change nobody asked for.
        session = _RecordingSession()

        await dao_factory(session).commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=_commit(uuid4()),
        )

        assert not _took_the_lock(session), (
            "a commit with no guard to protect took the variant lock, which serializes "
            "writers that were never serialized before"
        )
        assert session.added, "the commit did not insert"

    async def test_a_no_change_check_takes_the_lock(self, dao_factory):
        # The comparison is only meaningful against a head that cannot move under it, so
        # asking for one has to take the lock even with no expected head to check.
        session = _RecordingSession()

        await dao_factory(session).commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=_commit(uuid4()),
            no_change_check=_refuses_nothing,
        )

        assert _took_the_lock(session), (
            "the no-change comparison ran without the lock, so it read a head another "
            "writer could move before the insert"
        )

    async def test_an_expected_head_takes_the_lock(self, dao_factory):
        head_id = uuid4()
        session = _RecordingSession(head_id=head_id)

        await dao_factory(session).commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=_commit(uuid4()),
            expected_head_revision_id=head_id,
        )

        assert _took_the_lock(session)

    async def test_a_commit_with_no_variant_takes_no_lock(self, dao_factory):
        # There is no row to lock. Asking for the guard cannot conjure one, and the
        # statement would lock nothing while looking like it locked something.
        from oss.src.core.git.dtos import RevisionCommit

        session = _RecordingSession()

        await dao_factory(session).commit_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            revision_commit=RevisionCommit(
                slug=uuid4().hex[-12:],
                artifact_id=uuid4(),
            ),
            no_change_check=_refuses_nothing,
        )

        assert not _took_the_lock(session)


class TestTheFlagOffCommitPathTakesNoLock:
    """The end-to-end version of the same claim, through the service.

    The DAO cells above prove the condition. This one proves the WRAPPER honors it: with
    the flag off it hands down no comparison, so nothing downstream can take the lock.
    """

    @staticmethod
    def _service(flag):
        from unittest.mock import AsyncMock, patch

        from oss.src.core.workflows.service import WorkflowsService

        service = WorkflowsService(workflows_dao=AsyncMock())
        return service, patch.object(
            __import__(
                "oss.src.core.workflows.service", fromlist=["env"]
            ).env.agenta.api.workflows,
            "ordered_operations_enabled",
            flag,
        )

    async def _commit_through(self, flag):
        from unittest.mock import AsyncMock

        from oss.src.core.workflows.dtos import WorkflowRevision, WorkflowRevisionCommit

        service, flag_patch = self._service(flag)
        variant_id = uuid4()
        head = WorkflowRevision(
            id=uuid4(),
            workflow_variant_id=variant_id,
            data={"parameters": {"agent": {"instructions": "old"}}},
        )
        service.fetch_workflow_revision = AsyncMock(return_value=head)
        service.commit_workflow_revision = AsyncMock(return_value=head)

        with flag_patch:
            await service.commit_workflow_revision_checked(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=WorkflowRevisionCommit(
                    workflow_variant_id=variant_id,
                    data={"parameters": {"agent": {"instructions": "new"}}},
                ),
            )

        return service.commit_workflow_revision.await_args.kwargs["no_change_check"]

    async def test_flag_off_hands_down_no_comparison(self):
        assert await self._commit_through(False) is None, (
            "the flag-off path asked for the no-change comparison, which takes the "
            "variant lock and changes today's behavior"
        )

    async def test_flag_on_hands_down_the_comparison(self):
        assert await self._commit_through(True) is not None
