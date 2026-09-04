"""The watchdog loop must survive a failing pass and go round again.

Root cause of the integration-stack silence on 2026-09-04: `orphan_sweep_loop`'s generic
error handler called `log.exception(...)`, but `log` is a `MultiLogger`, which defines no
`exception` method and no `__getattr__`. The first sweep error -- a `session_executions`
column that did not exist yet during a migration window -- turned that handler into an
`AttributeError` that escaped the `while` loop and killed the watchdog task for the life of
the process. There was no timeout log, no error log, and no further pass, so stale rows were
never settled. The `asyncio.wait_for` guard could not help, because the defect was in the
handler, not in a pass that ran long.

These tests drive the loop, not a single pass, so the error handler is exercised: a pass
that raises must be logged and the loop must run a second pass; the same must hold for a pass
the timeout cuts. The single-pass behavior lives in `test_execution_watchdog.py`.
"""

import asyncio

import pytest

from oss.src.tasks.asyncio.sessions import orphan_sweep


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def _noop_sleep(*_args, **_kwargs):
    return None


class _RecordingLog:
    """A stand-in for the module `MultiLogger`.

    It exposes only the methods `MultiLogger` really has, so a call the real logger cannot
    serve (for example `exception`) raises `AttributeError` here too, exactly as it did live.
    """

    def __init__(self):
        self.calls = []

    def error(self, *args, **kwargs):
        self.calls.append(("error", args, kwargs))

    def info(self, *args, **kwargs):
        self.calls.append(("info", args, kwargs))

    def warning(self, *args, **kwargs):
        self.calls.append(("warning", args, kwargs))


def _logged_errors(recorder):
    return [c for c in recorder.calls if c[0] == "error"]


async def _run_loop_over(monkeypatch, first_pass_raises):
    """Drive the loop over two passes: the first raises `first_pass_raises`, the second stops
    the loop with `CancelledError`. Returns the pass count and the recording logger."""
    passes = 0

    async def fake_sweep(*_args, **_kwargs):
        nonlocal passes
        passes += 1
        if passes == 1:
            raise first_pass_raises
        raise asyncio.CancelledError()

    recorder = _RecordingLog()
    monkeypatch.setattr(orphan_sweep, "run_orphan_sweep", fake_sweep)
    monkeypatch.setattr(orphan_sweep, "log", recorder)
    monkeypatch.setattr(orphan_sweep, "SWEEP_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(orphan_sweep.asyncio, "sleep", _noop_sleep)

    with pytest.raises(asyncio.CancelledError):
        await orphan_sweep.orphan_sweep_loop(engine=None, lock_engine=None)

    return passes, recorder


@pytest.mark.anyio
async def test_a_failing_pass_is_logged_and_the_loop_continues(
    anyio_backend, monkeypatch
):
    # A real error from inside a pass -- the shape of the live UndefinedColumnError.
    passes, recorder = await _run_loop_over(
        monkeypatch,
        RuntimeError("column session_executions.ending_written_at does not exist"),
    )

    # The loop survived the first error and ran a second pass. Before the fix, the handler
    # itself raised AttributeError on the first pass and the loop never reached pass two.
    assert passes == 2

    errors = _logged_errors(recorder)
    assert errors, "the failing pass must be logged"
    assert errors[0][2].get("exc_info"), "the error must carry the traceback"


@pytest.mark.anyio
async def test_a_timed_out_pass_is_logged_and_the_loop_continues(
    anyio_backend, monkeypatch
):
    # `asyncio.wait_for` raises TimeoutError when it cuts a pass that runs too long. The loop
    # must log it and go round again, never die.
    passes, recorder = await _run_loop_over(monkeypatch, asyncio.TimeoutError())

    assert passes == 2
    assert _logged_errors(recorder), "the timed-out pass must be logged"


@pytest.mark.anyio
async def test_a_hanging_pass_is_cut_by_the_timeout(anyio_backend, monkeypatch):
    """A pass that blocks forever must be cut by `asyncio.wait_for`, not hang the loop.

    The production floor on `pass_timeout` is 120 s, so the loop's own timeout is patched to a
    short value here to keep the test fast while still exercising the real `asyncio.wait_for`.
    """
    passes = 0

    async def fake_sweep(*_args, **_kwargs):
        nonlocal passes
        passes += 1
        if passes == 1:
            await asyncio.Event().wait()  # blocks forever
        raise asyncio.CancelledError()

    recorder = _RecordingLog()
    monkeypatch.setattr(orphan_sweep, "run_orphan_sweep", fake_sweep)
    monkeypatch.setattr(orphan_sweep, "log", recorder)
    monkeypatch.setattr(orphan_sweep, "SWEEP_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(orphan_sweep.asyncio, "sleep", _noop_sleep)

    real_wait_for = asyncio.wait_for

    async def short_wait_for(awaitable, timeout):  # noqa: ARG001
        return await real_wait_for(awaitable, timeout=0.05)

    monkeypatch.setattr(orphan_sweep.asyncio, "wait_for", short_wait_for)

    with pytest.raises(asyncio.CancelledError):
        await orphan_sweep.orphan_sweep_loop(engine=None, lock_engine=None)

    # The first pass hung; the timeout cut it and the loop ran a second pass.
    assert passes == 2
    assert _logged_errors(recorder), "the cut pass must be logged"
