"""The one-time artifact edit is atomic against two concurrent writers.

A fake session can show that the statement contains ``FOR UPDATE``, but only two real
Postgres connections prove that the loser re-reads the marker written by the winner.
The sibling conftest skips this test when Postgres is unavailable.
"""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.core.git.dtos import ArtifactEdit
from oss.src.dbs.postgres.shared.engine import TransactionsEngine


pytestmark = pytest.mark.integration

ARTIFACTS = "workflow_artifacts"
MARKER = "_agenta_agent_self_named"


@pytest.fixture
async def engine():
    instance = TransactionsEngine()
    try:
        yield instance
    finally:
        await instance.close()


async def _exec(engine, sql, params=None):
    async with engine.session() as session:
        return await session.execute(text(sql), params or {})


def _dao(engine):
    import oss.src.dbs.postgres.folders.dbes  # noqa: F401
    import oss.src.models.db_models  # noqa: F401
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


@pytest.fixture
async def artifact(engine):
    project = await _exec(
        engine,
        "SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1",
    )
    project_id = project.scalar_one_or_none()
    if project_id is None:
        pytest.skip("no project in the target database to attach the fixture to")

    artifact_id = uuid4()
    await _exec(
        engine,
        f"INSERT INTO {ARTIFACTS} (id, project_id, slug, name, meta, created_at) "
        "VALUES (:id, :project_id, :slug, :name, '{}'::jsonb, now())",
        {
            "id": artifact_id,
            "project_id": project_id,
            "slug": f"agent-{artifact_id.hex}",
            "name": "Untitled agent",
        },
    )
    yield {"id": artifact_id, "project_id": project_id}
    await _exec(
        engine,
        f"DELETE FROM {ARTIFACTS} WHERE id = :id",
        {"id": artifact_id},
    )


async def _rename(engine, artifact, name, gate):
    await gate.wait()
    return await _dao(engine).edit_artifact_once(
        project_id=artifact["project_id"],
        user_id=uuid4(),
        artifact_edit=ArtifactEdit(id=artifact["id"], name=name),
        marker_key=MARKER,
    )


async def test_exactly_one_concurrent_self_rename_wins(engine, artifact):
    gate = asyncio.Event()
    writers = asyncio.gather(
        _rename(engine, artifact, "Support Triage", gate),
        _rename(engine, artifact, "Research Assistant", gate),
    )
    await asyncio.sleep(0)
    gate.set()
    results = await writers

    winners = [result for result in results if result.status == "updated"]
    losers = [result for result in results if result.status == "already_marked"]
    assert len(winners) == 1
    assert len(losers) == 1

    stored = await _exec(
        engine,
        f"SELECT name, meta FROM {ARTIFACTS} WHERE id = :id",
        {"id": artifact["id"]},
    )
    name, meta = stored.one()
    assert name == winners[0].artifact.name
    assert meta[MARKER] is True
