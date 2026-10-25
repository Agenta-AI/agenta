"""Unit tests: run-level flag writers must not clobber each other.

Regression for the flaky
`TestEvaluationRunFlows::test_human_testcases_queue_annotate_stop_close_scenarios_then_run`
(closed run still reporting `is_active=True`).

The race, in order:

  1. the worker's `_finalize_run_after_slice` reads the run (`is_active=True`);
  2. `POST /stop` commits `is_active=False`;
  3. the worker writes back the flags it read in (1) -> `is_active=True` again;
  4. `POST /close` locks the run in that wrong state (closed runs reject edits,
     so it is never repaired).

`EvaluationsDAO.edit_run` merges only `model_fields_set` of the incoming flags
over the CURRENT stored flags, so the writers must send just the fields they own.

These tests are deterministic: `_FakeRunStore` stands in for the stored run row
but applies the PRODUCTION merge (`edit_run_flags`) and the production
closed-guard, and an `on_fetch` hook commits the concurrent writer exactly
between the caller's read and its write.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from agenta.sdk.evaluations.runtime.status import ProcessedScenario
from oss.src.core.evaluations.service import SimpleEvaluationsService
from oss.src.core.evaluations.tasks.processor import _finalize_run_after_slice
from oss.src.core.evaluations.types import (
    EvaluationClosedConflict,
    EvaluationRun,
    EvaluationRunFlags,
    EvaluationStatus,
)
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO
from oss.src.dbs.postgres.evaluations.dbes import EvaluationRunDBE
from oss.src.dbs.postgres.evaluations.utils import edit_run_flags


class _FakeRunStore:
    """One stored run row + the DAO's edit semantics (no database)."""

    def __init__(self, *, flags: EvaluationRunFlags, status: EvaluationStatus):
        self.run_id = uuid4()
        # The DAO persists the FULL flags dump, so a fetched DTO has every flag
        # key present (i.e. every field is in `model_fields_set`).
        self.flags = flags.model_dump()
        self.status = status
        # Simulates a concurrent writer committing right after a read.
        self.on_fetch = None

    def snapshot(self) -> EvaluationRun:
        return EvaluationRun(
            id=self.run_id,
            flags=EvaluationRunFlags(**self.flags),
            status=self.status,
        )

    async def fetch_run(self, *, project_id, run_id):
        snapshot = self.snapshot()
        if self.on_fetch is not None:
            self.on_fetch(self)
        return snapshot

    async def edit_run(self, *, project_id, user_id, run):
        if self.flags.get("is_closed", False):
            raise EvaluationClosedConflict(run_id=run.id)

        merged = edit_run_flags(run, base_flags=EvaluationRunFlags(**self.flags))
        self.flags = merged.model_dump()

        if run.status is not None:
            self.status = run.status

        return self.snapshot()


def _queue_run_flags(**overrides) -> EvaluationRunFlags:
    return EvaluationRunFlags(
        is_active=True,
        is_queue=True,
        has_human=True,
        has_testcases=True,
        has_evaluators=True,
        **overrides,
    )


def _processed(*, pending: bool) -> list:
    return [
        ProcessedScenario(
            scenario=SimpleNamespace(id=uuid4()),
            has_pending=pending,
        )
    ]


# --- worker finalize ----------------------------------------------------------


@pytest.mark.asyncio
async def test_finalize_non_terminal_slice_does_not_resurrect_is_active_after_stop():
    # Human-queue slice: scenarios park at PENDING -> run status RUNNING
    # (non-terminal), so finalize must leave `is_active` alone.
    store = _FakeRunStore(flags=_queue_run_flags(), status=EvaluationStatus.RUNNING)
    slice_run = store.snapshot()  # the slice's (soon stale) view: is_active=True

    def stop_lands(s):
        s.flags["is_active"] = False

    store.on_fetch = stop_lands

    await _finalize_run_after_slice(
        project_id=uuid4(),
        user_id=uuid4(),
        run=slice_run,
        processed=_processed(pending=True),
        evaluations_service=store,
    )

    assert store.flags["is_active"] is False, store.flags
    assert store.flags["is_queue"] is True
    assert store.flags["has_human"] is True
    assert store.status == EvaluationStatus.RUNNING


@pytest.mark.asyncio
async def test_finalize_terminal_slice_only_flips_is_active_and_keeps_concurrent_updates():
    store = _FakeRunStore(flags=_queue_run_flags(), status=EvaluationStatus.RUNNING)
    slice_run = store.snapshot()

    def concurrent_flag_update(s):
        # e.g. the default-queue reconciliation committing after finalize's read
        s.flags["is_queue"] = False

    store.on_fetch = concurrent_flag_update

    await _finalize_run_after_slice(
        project_id=uuid4(),
        user_id=uuid4(),
        run=slice_run,
        processed=_processed(pending=False),
        evaluations_service=store,
    )

    assert store.status == EvaluationStatus.SUCCESS
    assert store.flags["is_active"] is False, store.flags
    assert store.flags["is_queue"] is False, "finalize reverted a concurrent update"


@pytest.mark.asyncio
async def test_finalize_skips_quietly_when_run_was_closed_mid_flight():
    store = _FakeRunStore(
        flags=_queue_run_flags(is_closed=True),
        status=EvaluationStatus.RUNNING,
    )

    await _finalize_run_after_slice(  # must not raise
        project_id=uuid4(),
        user_id=uuid4(),
        run=store.snapshot(),
        processed=_processed(pending=False),
        evaluations_service=store,
    )

    assert store.flags["is_closed"] is True
    assert store.flags["is_active"] is True  # untouched: closed is a lock
    assert store.status == EvaluationStatus.RUNNING


# --- stop ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stop_only_flips_is_active_and_does_not_write_back_stale_state():
    store = _FakeRunStore(flags=_queue_run_flags(), status=EvaluationStatus.RUNNING)

    def other_writer_commits(s):
        # committed after stop's read, before stop's write
        s.status = EvaluationStatus.SUCCESS
        s.flags["is_queue"] = False

    store.on_fetch = other_writer_commits

    service = object.__new__(SimpleEvaluationsService)
    service.evaluations_service = store

    run = await service._deactivate_evaluation_run(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=store.run_id,
    )

    assert run is not None
    assert store.flags["is_active"] is False, store.flags
    assert store.status == EvaluationStatus.SUCCESS, "stop wrote back a stale status"
    assert store.flags["is_queue"] is False, "stop reverted a concurrent flag update"


# --- close --------------------------------------------------------------------


class _FakeDaoSession:
    def __init__(self, dbes):
        self._dbes = dbes
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    async def execute(self, _stmt):
        dbes = self._dbes
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(first=lambda: dbes[0], all=lambda: dbes),
        )

    async def commit(self):
        self.committed = True


def _run_dbe(**flag_overrides) -> EvaluationRunDBE:
    return EvaluationRunDBE(
        project_id=uuid4(),
        id=uuid4(),
        flags=_queue_run_flags(**flag_overrides).model_dump(),
        status="running",
    )


def _dao_over(dbes):
    session = _FakeDaoSession(dbes)
    return EvaluationsDAO(engine=SimpleNamespace(session=lambda: session)), session


@pytest.mark.asyncio
async def test_close_run_leaves_the_run_inactive_and_keeps_other_flags():
    # A closed run is never active. This also neutralises any is_active=True
    # that slipped in between stop and close.
    dbe = _run_dbe()
    dao, session = _dao_over([dbe])

    closed = await dao.close_run(
        project_id=dbe.project_id,
        user_id=uuid4(),
        run_id=dbe.id,
    )

    assert session.committed is True
    assert closed is not None
    assert closed.flags.is_closed is True
    assert closed.flags.is_active is False
    assert dbe.flags["is_queue"] is True
    assert dbe.flags["has_human"] is True


@pytest.mark.asyncio
async def test_close_runs_leaves_every_run_inactive():
    dbes = [_run_dbe(), _run_dbe()]
    dao, session = _dao_over(dbes)

    closed = await dao.close_runs(
        project_id=dbes[0].project_id,
        user_id=uuid4(),
        run_ids=[dbe.id for dbe in dbes],
    )

    assert session.committed is True
    assert len(closed) == 2
    assert all(run.flags.is_closed is True for run in closed)
    assert all(run.flags.is_active is False for run in closed)
