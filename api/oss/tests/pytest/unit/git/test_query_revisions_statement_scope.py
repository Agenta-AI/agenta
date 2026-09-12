"""`query_revisions` must scope the statement it actually executes to the project.

The grouped path rebuilds the outer statement from scratch around an `IN` over the
grouped subquery, which drops the predicates the base statement carried. Every index on
the revision tables leads with `project_id`, so an outer query without it cannot seek.

The DAO runs against a fake engine that records the compiled statement and returns no
rows, so no database is involved.
"""

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

import oss.src.models.db_models  # noqa: F401  registers the `projects` table
from oss.src.core.git.dtos import RevisionGrouping, RevisionQuery
from oss.src.core.shared.dtos import Reference
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)


class _RecordingResult:
    def scalars(self):
        return self

    def all(self):
        return []


class _RecordingSession:
    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _RecordingResult()

    async def commit(self):
        return None

    async def rollback(self):
        return None

    async def close(self):
        return None


class _RecordingEngine:
    def __init__(self):
        self.last_session = None

    @asynccontextmanager
    async def session(self):
        self.last_session = _RecordingSession()
        yield self.last_session


def _compile(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def _split_outer_where(sql: str) -> str:
    """The outer WHERE clause, with the parenthesised subquery removed."""
    depth = 0
    outer = []
    for character in sql:
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
        elif depth == 0:
            outer.append(character)
    return "".join(outer)


async def _run_query(*, grouping):
    engine = _RecordingEngine()
    dao = GitDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
        engine=engine,
    )

    await dao.query_revisions(
        project_id=uuid4(),
        revision_query=RevisionQuery(),
        grouping=grouping,
        artifact_refs=[Reference(id=uuid4())],
    )

    assert engine.last_session is not None
    assert len(engine.last_session.statements) == 1
    return _compile(engine.last_session.statements[0])


@pytest.mark.asyncio
async def test_grouped_query_scopes_the_outer_statement_to_the_project():
    sql = await _run_query(grouping=RevisionGrouping(by="artifact", get="latest"))

    assert "IN (SELECT" in sql, "expected the grouped subquery shape"

    outer_where = _split_outer_where(sql)
    assert "workflow_revisions.project_id = " in outer_where


@pytest.mark.asyncio
async def test_ungrouped_query_scopes_the_statement_to_the_project():
    sql = await _run_query(grouping=None)

    assert "workflow_revisions.project_id = " in _split_outer_where(sql)
