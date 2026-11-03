from datetime import datetime, timezone
from uuid import uuid4
import pytest

from oss.src.core.evaluations.types import (
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunEdit,
    Reference,
)
from oss.src.dbs.postgres.evaluations import dao as dao_module
from oss.src.dbs.postgres.evaluations.dbes import EvaluationRunDBE


class _DummyScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _DummyResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _DummyScalars(self._rows)


class _DummySession:
    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _stmt):
        return _DummyResult(self._rows)

    async def commit(self):
        return None


class _DummySessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_engine(monkeypatch, session):
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _DummySessionContext(session)}
    )()
    monkeypatch.setattr(dao_module, "get_transactions_engine", lambda: mock_engine)
    return mock_engine


@pytest.mark.asyncio
async def test_edit_run_without_data_preserves_references(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()

    existing_references = [{"testset": {"id": str(uuid4())}, "key": "testset_revision"}]
    existing_data = {
        "steps": [
            {
                "key": "testset_revision",
                "type": "annotation",
                "origin": "auto",
                "references": {
                    "testset_revision": {
                        "testset": {"id": existing_references[0]["testset"]["id"]}
                    }
                },
            }
        ]
    }

    run_dbe = EvaluationRunDBE(
        id=run_id,
        project_id=project_id,
        name="initial-run-name",
        references=existing_references,
        data=existing_data,
        flags={},
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    session = _DummySession([run_dbe])
    _patch_engine(monkeypatch, session)

    dao = dao_module.EvaluationsDAO()
    dao.engine = type(
        "E", (), {"session": lambda self: _DummySessionContext(session)}
    )()

    # Edit without `data` (rename only)
    edit_dto = EvaluationRunEdit(
        id=run_id,
        name="renamed-run",
        data=None,
    )

    result = await dao.edit_run(
        project_id=project_id,
        user_id=user_id,
        run=edit_dto,
    )

    assert result is not None
    assert run_dbe.name == "renamed-run"
    # References must be preserved intact, not overwritten with None
    assert run_dbe.references == existing_references
    assert run_dbe.data == existing_data


@pytest.mark.asyncio
async def test_edit_run_with_data_updates_references(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    new_testset_id = uuid4()

    existing_references = [{"testset": {"id": str(uuid4())}, "key": "old_key"}]

    run_dbe = EvaluationRunDBE(
        id=run_id,
        project_id=project_id,
        name="run-name",
        references=existing_references,
        data={"steps": []},
        flags={},
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    session = _DummySession([run_dbe])
    _patch_engine(monkeypatch, session)

    dao = dao_module.EvaluationsDAO()
    dao.engine = type(
        "E", (), {"session": lambda self: _DummySessionContext(session)}
    )()

    new_step = EvaluationRunDataStep(
        key="step1",
        type="annotation",
        origin="auto",
        references={"ref1": Reference(id=new_testset_id)},
    )
    edit_dto = EvaluationRunEdit(
        id=run_id,
        data=EvaluationRunData(steps=[new_step]),
    )

    result = await dao.edit_run(
        project_id=project_id,
        user_id=user_id,
        run=edit_dto,
    )

    assert result is not None
    assert run_dbe.references is not None
    assert len(run_dbe.references) == 1
    assert run_dbe.references[0]["id"] == str(new_testset_id)
    assert run_dbe.references[0]["key"] == "ref1"


@pytest.mark.asyncio
async def test_edit_runs_without_data_preserves_references(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()

    runs_dbes = []
    edit_dtos = []
    for i in range(2):
        run_id = uuid4()
        refs = [{"testset": {"id": str(uuid4())}, "key": f"key_{i}"}]
        run_dbe = EvaluationRunDBE(
            id=run_id,
            project_id=project_id,
            name=f"run-{i}",
            references=refs,
            data={"steps": []},
            flags={},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        runs_dbes.append(run_dbe)
        edit_dtos.append(
            EvaluationRunEdit(
                id=run_id,
                name=f"renamed-run-{i}",
                data=None,
            )
        )

    session = _DummySession(runs_dbes)
    _patch_engine(monkeypatch, session)

    dao = dao_module.EvaluationsDAO()
    dao.engine = type(
        "E", (), {"session": lambda self: _DummySessionContext(session)}
    )()

    results = await dao.edit_runs(
        project_id=project_id,
        user_id=user_id,
        runs=edit_dtos,
    )

    assert len(results) == 2
    for i, run_dbe in enumerate(runs_dbes):
        assert run_dbe.name == f"renamed-run-{i}"
        assert run_dbe.references == [
            {
                "testset": {"id": run_dbe.references[0]["testset"]["id"]},
                "key": f"key_{i}",
            }
        ]
