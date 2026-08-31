from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

from oss.src.core.git.dtos import ArtifactEdit


class _Result:
    def __init__(self, row):
        self.row = row

    def scalars(self):
        return self

    def first(self):
        return self.row


class _Session:
    def __init__(self, row):
        self.row = row
        self.executed = []
        self.commits = 0

    async def execute(self, statement):
        self.executed.append(str(statement))
        return _Result(self.row)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _row):
        return None


def _dao_and_session(*, marker=False):
    import oss.src.models.db_models  # noqa: F401
    from oss.src.dbs.postgres.git.dao import GitDAO
    from oss.src.dbs.postgres.workflows.dbes import (
        WorkflowArtifactDBE,
        WorkflowRevisionDBE,
        WorkflowVariantDBE,
    )

    row = WorkflowArtifactDBE(
        id=uuid4(),
        project_id=uuid4(),
        slug="agent",
        name="Untitled agent",
        meta={"_agenta_agent_self_named": True} if marker else {},
    )
    session = _Session(row)

    @asynccontextmanager
    async def _session():
        yield session

    dao = GitDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
        engine=SimpleNamespace(session=_session),
    )
    return dao, session, row


async def test_one_time_artifact_edit_locks_before_setting_the_marker():
    dao, session, row = _dao_and_session()

    result = await dao.edit_artifact_once(
        project_id=row.project_id,
        user_id=uuid4(),
        artifact_edit=ArtifactEdit(id=row.id, name="Support Triage"),
        marker_key="_agenta_agent_self_named",
    )

    assert any("FOR UPDATE" in statement for statement in session.executed)
    assert session.commits == 1
    assert result.status == "updated"
    assert result.artifact.name == "Support Triage"
    assert result.artifact.meta["_agenta_agent_self_named"] is True


async def test_one_time_artifact_edit_does_not_write_after_the_marker():
    dao, session, row = _dao_and_session(marker=True)

    result = await dao.edit_artifact_once(
        project_id=row.project_id,
        user_id=uuid4(),
        artifact_edit=ArtifactEdit(id=row.id, name="Another Name"),
        marker_key="_agenta_agent_self_named",
    )

    assert any("FOR UPDATE" in statement for statement in session.executed)
    assert result.status == "already_marked"
    assert result.artifact.name == "Untitled agent"
    assert session.commits == 0
    assert row.name == "Untitled agent"
