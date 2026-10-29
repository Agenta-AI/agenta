"""Revision `ee0000000008` (step 2b fold of meter rows that still carry a workspace).

ee0000000007 moved every row with a workspace. During the step 2 rollout, step-1 pods
could still write a per-user `TRACES_RETRIEVED` row under its old id (a straggler).
ee0000000008 reruns the same walk, so the straggler is added into the re-keyed row and
no row keeps a workspace before step 2b code stops reading the column.

Each case seeds its own organization and limits the walk to it.
"""

import functools
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    seed_organization,
)
from ee.tests.pytest.integration.meters.test_meters_rekey_postgres import (
    _FakeRedis,
    _id,
    _insert,
    _meters,
)


pytestmark = pytest.mark.integration

_VERSIONS = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/core_ee/versions"
)


@functools.lru_cache(maxsize=1)
def _revision():
    path = _VERSIONS / "ee0000000008_refold_meters_without_workspace.py"
    spec = importlib.util.spec_from_file_location("_revision_ee008", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(organization_ids):
    step_2 = _revision()._step_2_revision()

    async def run():
        engine = get_transactions_engine()._engine
        async with engine.connect() as connection:
            connection = await connection.execution_options(
                isolation_level="AUTOCOMMIT"
            )
            return await connection.run_sync(
                lambda sync: step_2.run(
                    sync,
                    organization_ids=organization_ids,
                    lock=step_2.ReportLock(_FakeRedis()),
                )
            )

    return run()


@pytest.fixture
async def org():
    seeded = await seed_organization(members={"m": "editor"})
    yield SimpleNamespace(
        id=seeded.organization_id,
        ws=seeded.workspace_ids[0],
        prj=seeded.project_ids[0],
        usr=seeded.user_ids["m"],
    )
    await delete_seeded_organization(seeded)


def test_ee008_follows_ee007_and_reuses_its_run():
    revision = _revision()
    assert (revision.revision, revision.down_revision) == (
        "ee0000000008",
        "ee0000000007",
    )
    step_2 = revision._step_2_revision()
    assert step_2.revision == "ee0000000007"
    assert callable(step_2.run)


async def test_ee008_folds_a_straggler_into_the_rekeyed_row(org):
    # ee0000000007 already moved the row: it has the step-2 id and no workspace.
    await _insert(org=org.id, wrk=None, prj=org.prj, usr=org.usr, value=40, synced=30)
    # A step-1 pod counted three more reads under the old id after the move.
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=3, synced=1)
    counts = await _run([org.id])
    rows = await _meters(org.id)
    new_id = _id(org=org.id, prj=org.prj, usr=org.usr)
    assert list(rows) == [new_id]
    assert (rows[new_id]["value"], rows[new_id]["synced"]) == (43, 31)
    assert rows[new_id]["workspace_id"] is None
    assert counts["rows"] == 1


async def test_ee008_leaves_no_row_with_a_workspace_and_is_idempotent(org):
    await _insert(org=org.id, wrk=None, prj=org.prj, usr=org.usr, value=4, synced=4)
    await _insert(org=org.id, wrk=uuid4(), prj=org.prj, usr=org.usr, value=2, synced=0)
    await _run([org.id])
    after_first = await _meters(org.id)
    assert all(row["workspace_id"] is None for row in after_first.values())
    counts = await _run([org.id])
    assert counts == {"batches": 0, "rows": 0, "inserted_or_folded": 0}
    assert await _meters(org.id) == after_first


async def test_ee008_without_stragglers_changes_nothing(org):
    await _insert(org=org.id, wrk=None, prj=org.prj, usr=org.usr, value=9, synced=5)
    before = await _meters(org.id)
    counts = await _run([org.id])
    assert counts["rows"] == 0
    assert await _meters(org.id) == before


def test_ee008_upgrade_runs_ee007_in_an_autocommit_block(monkeypatch):
    revision = _revision()
    calls = []

    class _StepTwo:
        @staticmethod
        def run(bind, **kwargs):
            calls.append(kwargs)

    class _Context:
        def autocommit_block(self):
            import contextlib

            return contextlib.nullcontext()

    statements = []

    class _Bind:
        def execute(self, statement):
            statements.append(str(statement))

    monkeypatch.setattr(revision, "_step_2_revision", lambda: _StepTwo)
    monkeypatch.setattr(revision.op, "get_context", lambda: _Context())
    monkeypatch.setattr(revision.op, "get_bind", lambda: _Bind())
    revision.upgrade()
    assert calls == [{}]
    assert statements[:2] == [
        "SET lock_timeout = '2s'",
        "SET statement_timeout = '60s'",
    ]
    assert statements[-2:] == ["RESET lock_timeout", "RESET statement_timeout"]
