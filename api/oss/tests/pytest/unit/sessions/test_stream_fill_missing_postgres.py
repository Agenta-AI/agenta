"""`fill_missing` against a real Postgres — the statement, not a fake of it.

Fill-once is enforced by SQL (COALESCE per column behind a NULL guard), so a fake that
mirrors the rule proves the service calls it correctly and nothing about whether the rule
holds. The cases that matter are the ones a mistake in the statement would break: a
second fill must not overwrite, and a rename must survive every later beat.

Requires the core_oss migration chain applied and POSTGRES_URI_CORE pointed at that
database (same fixture shape as test_wp5_dao_fanout.py); skipped when Postgres is
unreachable.
"""

import uuid

import pytest
from sqlalchemy import text

from oss.src.core.sessions.streams.dtos import (
    SessionStreamCreate,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.types import ReferenceKey, SessionReference
import oss.src.models.db_models  # noqa: F401
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE  # noqa: F401
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def project():
    """Provision the minimal FK chain: user -> org -> workspace -> project."""
    engine = get_transactions_engine()

    user_id = uuid.uuid4()
    org_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "fill-missing-test",
                "email": f"fill-missing-test-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {"id": org_id, "name": "fill-missing-test-org", "owner_id": user_id},
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "fill-missing-test-ws",
                "organization_id": org_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects (id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :project_name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "project_name": "fill-missing-test-project",
                "workspace_id": workspace_id,
                "organization_id": org_id,
            },
        )
        await session.commit()

    yield {"project_id": project_id, "user_id": user_id}

    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM session_streams WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )
        await session.execute(
            text("DELETE FROM workspaces WHERE id = :id"), {"id": workspace_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"), {"id": org_id}
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()


def _references(slug: str) -> list[SessionReference]:
    return [
        SessionReference(id=uuid.uuid4(), slug=slug, key=ReferenceKey.workflow),
        SessionReference(id=uuid.uuid4(), slug=slug, key=ReferenceKey.workflow_variant),
    ]


async def _stream(dao: SessionStreamsDAO, project_id, session_id: str):
    return await dao.create(
        project_id=project_id,
        user_id=None,
        stream=SessionStreamCreate(session_id=session_id),
    )


@pytest.mark.asyncio
async def test_fill_missing_writes_then_refuses_to_overwrite(project):
    dao = SessionStreamsDAO()
    project_id = project["project_id"]
    session_id = f"fill_{uuid.uuid4().hex[:12]}"
    await _stream(dao, project_id, session_id)

    first_references = _references("first")
    filled = await dao.fill_missing(
        project_id=project_id,
        session_id=session_id,
        name="First title",
        references=first_references,
    )
    assert filled is True
    row = await dao.get_by_session_id(project_id=project_id, session_id=session_id)
    assert row.name == "First title"
    assert row.references == first_references

    # The second beat proposes something else entirely; both columns must ignore it.
    filled_again = await dao.fill_missing(
        project_id=project_id,
        session_id=session_id,
        name="Second title",
        references=_references("second"),
    )
    row = await dao.get_by_session_id(project_id=project_id, session_id=session_id)
    assert filled_again is False
    assert row.name == "First title"
    assert row.references == first_references


@pytest.mark.asyncio
async def test_a_rename_survives_every_later_fill(project):
    """The invariant the whole design rests on: the runner re-proposes forever, and a
    human's title must outlive all of it."""
    dao = SessionStreamsDAO()
    project_id = project["project_id"]
    session_id = f"fill_{uuid.uuid4().hex[:12]}"
    await _stream(dao, project_id, session_id)

    await dao.update_header(
        project_id=project_id,
        user_id=project["user_id"],
        session_id=session_id,
        header=SessionStreamHeaderEdit(name="Named by a human"),
    )

    for _ in range(3):
        await dao.fill_missing(
            project_id=project_id,
            session_id=session_id,
            name="Proposed by the runner",
        )

    row = await dao.get_by_session_id(project_id=project_id, session_id=session_id)
    assert row.name == "Named by a human"


@pytest.mark.asyncio
async def test_each_column_fills_independently(project):
    # A beat carrying only a name must still fill references later, and vice versa —
    # the guard is per column, not per row.
    dao = SessionStreamsDAO()
    project_id = project["project_id"]
    session_id = f"fill_{uuid.uuid4().hex[:12]}"
    await _stream(dao, project_id, session_id)

    await dao.fill_missing(
        project_id=project_id, session_id=session_id, name="Only a name"
    )
    references = _references("later")
    await dao.fill_missing(
        project_id=project_id, session_id=session_id, references=references
    )

    row = await dao.get_by_session_id(project_id=project_id, session_id=session_id)
    assert row.name == "Only a name"
    assert row.references == references
    assert row.references[0].key == "workflow"


@pytest.mark.asyncio
async def test_a_killed_row_is_not_filled(project):
    """`deleted_at IS NULL` is in the WHERE for a reason: a late beat from the turn that
    was killed must not write to the tombstone."""
    dao = SessionStreamsDAO()
    project_id = project["project_id"]
    session_id = f"fill_{uuid.uuid4().hex[:12]}"
    await _stream(dao, project_id, session_id)
    await dao.delete_by_session_id(project_id=project_id, session_id=session_id)

    filled = await dao.fill_missing(
        project_id=project_id, session_id=session_id, name="Too late"
    )

    assert filled is False


@pytest.mark.asyncio
async def test_the_stream_reference_filter_matches_by_containment(project):
    """The stream half of the reference-scoped list filter, against real `@>`.

    Containment is a subset match on a JSONB array, which is easy to get wrong in a way
    that still compiles: the operand must match an element that is a SUPERSET of it, and
    it must not carry `key` or it would miss every untagged row.
    """
    dao = SessionStreamsDAO()
    project_id = project["project_id"]
    workflow_id = uuid.uuid4()

    matching = f"fill_{uuid.uuid4().hex[:12]}"
    await _stream(dao, project_id, matching)
    await dao.fill_missing(
        project_id=project_id,
        session_id=matching,
        references=[
            SessionReference(id=workflow_id, slug="chat", key=ReferenceKey.workflow),
            SessionReference(id=uuid.uuid4(), key=ReferenceKey.workflow_variant),
        ],
    )

    other = f"fill_{uuid.uuid4().hex[:12]}"
    await _stream(dao, project_id, other)
    await dao.fill_missing(
        project_id=project_id,
        session_id=other,
        references=[SessionReference(id=uuid.uuid4(), key=ReferenceKey.workflow)],
    )

    found = await dao.query_session_ids_by_references(
        project_id=project_id,
        references=[SessionReference(id=workflow_id)],
        limit=500,
    )
    assert found == [matching]

    # A filter that names the family must still match: `key` is excluded from the operand.
    found_with_key = await dao.query_session_ids_by_references(
        project_id=project_id,
        references=[SessionReference(id=workflow_id, key=ReferenceKey.workflow)],
        limit=500,
    )
    assert found_with_key == [matching]

    # And an untagged row written before the discriminator existed is still findable.
    legacy = f"fill_{uuid.uuid4().hex[:12]}"
    legacy_id = uuid.uuid4()
    await _stream(dao, project_id, legacy)
    await dao.fill_missing(
        project_id=project_id,
        session_id=legacy,
        references=[SessionReference(id=legacy_id)],
    )
    assert await dao.query_session_ids_by_references(
        project_id=project_id,
        references=[SessionReference(id=legacy_id, key=ReferenceKey.workflow)],
        limit=500,
    ) == [legacy]


@pytest.mark.asyncio
async def test_fill_missing_is_scoped_to_its_project(project):
    dao = SessionStreamsDAO()
    project_id = project["project_id"]
    session_id = f"fill_{uuid.uuid4().hex[:12]}"
    await _stream(dao, project_id, session_id)

    filled = await dao.fill_missing(
        project_id=uuid.uuid4(), session_id=session_id, name="Another tenant"
    )

    row = await dao.get_by_session_id(project_id=project_id, session_id=session_id)
    assert filled is False
    assert row.name is None
