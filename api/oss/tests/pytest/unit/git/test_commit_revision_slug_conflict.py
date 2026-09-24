"""A duplicate revision slug must answer 409, not a swallowed `None`.

`workflow_revisions_project_id_slug_key` makes the slug unique per project. Committing a
revision whose slug another revision already uses violates it, and the DAO translates
that violation into `EntityCreationConflict` -- a typed ANSWER naming the conflicting
columns.

`commit_revision` runs under `@suppress_exceptions`, which turns every non-excluded
exception into a silent `None`. While `EntityCreationConflict` was missing from the
exclude list, a duplicate slug was suppressed exactly like a genuine failure: the DAO
answered `None`, the service reported `CommitOutcome(revision=None, status="committed")`,
and the router turned that into a 500 `commit_failed` -- telling the caller the server
broke, when what actually happened is that the slug was taken.

These tests drive the DAO with a fake session, so they run in the unit suite with no
database. The duplicate is raised at `commit()`, the way Postgres reports it.
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from oss.src.core.shared.exceptions import EntityCreationConflict
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from sqlalchemy.exc import IntegrityError


class _UniqueViolation(AsyncAdapt_asyncpg_dbapi.IntegrityError):
    """The driver error Postgres raises for a duplicate key.

    The DETAIL line is what `check_entity_creation_conflict` parses: the column names
    and their values, exactly as asyncpg renders them.
    """

    def __init__(self, constraint: str, keys: str, values: str):
        super().__init__(
            f'duplicate key value violates unique constraint "{constraint}"\n'
            f"DETAIL:  Key ({keys})=({values}) already exists."
        )


class _WrappedUniqueViolation(IntegrityError):
    """What SQLAlchemy raises: its own error with the driver's on `.orig`."""

    def __init__(self, constraint: str, keys: str, values: str):
        super().__init__(
            "INSERT INTO workflow_revisions ...",
            {},
            _UniqueViolation(constraint, keys, values),
        )


class _ConflictingSession:
    """A fake session that fails the insert the way a duplicate slug does."""

    def __init__(self):
        self.executed = []
        self.committed = False

    async def execute(self, statement):
        self.executed.append(str(statement))
        return SimpleNamespace(
            scalar_one_or_none=lambda: None,
            scalar_one=lambda: 0,
        )

    def add(self, entity):
        pass

    async def commit(self):
        self.committed = True
        raise _WrappedUniqueViolation(
            constraint="workflow_revisions_project_id_slug_key",
            keys="project_id, slug",
            values="11111111-1111-1111-1111-111111111111, taken-slug",
        )

    async def refresh(self, entity, attribute_names=None):
        return None

    async def close(self):
        return None

    async def rollback(self):
        return None


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
        return dao

    return _build


def _commit(slug="taken-slug"):
    from oss.src.core.git.dtos import RevisionCommit

    return RevisionCommit(
        slug=slug,
        variant_id=uuid4(),
        artifact_id=uuid4(),
    )


class TestDuplicateSlug:
    async def test_a_duplicate_slug_raises_the_typed_conflict(self, dao_factory):
        # The regression: suppression used to turn this ANSWER into `None`, which the
        # router reported as 500 commit_failed. It must reach the caller as the conflict
        # it is, so `intercept_exceptions` can answer 409.
        session = _ConflictingSession()
        dao = dao_factory(session)

        with pytest.raises(EntityCreationConflict):
            await dao.commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
            )

    async def test_the_conflict_names_the_taken_slug(self, dao_factory):
        # A 409 that does not say WHICH column was taken is a 409 the caller cannot act
        # on: the message is built from this conflict map.
        session = _ConflictingSession()
        dao = dao_factory(session)

        with pytest.raises(EntityCreationConflict) as exc_info:
            await dao.commit_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                revision_commit=_commit(),
            )

        assert exc_info.value.conflict == {"slug": "taken-slug"}
