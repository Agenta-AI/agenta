"""Unit tests for the fix to ``auto_custom_code_run_v0`` (issue #7505).

Verifies that:
- ``execute_code_safely`` is invoked via ``asyncio.to_thread`` (i.e. off the
  event loop) so the uvicorn worker stays responsive during sandbox execution.
- A ``CustomCodeServerV0Error`` is raised when the sandbox call exceeds the
  configured timeout instead of blocking the worker until gunicorn kills it.
- The timeout is configurable via ``AGENTA_CODE_EVALUATOR_TIMEOUT``.
- Normal (non-timeout) results are still returned correctly.
"""

import threading

import pytest

from agenta.sdk.engines.running import handlers as code_handlers
from agenta.sdk.engines.running.errors import CustomCodeServerV0Error


# The handler is wrapped by ``@instrument()``.  Access the raw function so
# tests don't need a tracing context.
_auto_custom_code_run_v0 = code_handlers.auto_custom_code_run_v0.__original_handler__


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MINIMAL_PARAMETERS = {
    "code": "def evaluate(app_params, inputs, output, correct_answer): return 1.0",
    "threshold": 0.5,
    "runtime": "python",
    "correct_answer_key": "correct_answer",
}

_MINIMAL_INPUTS = {"question": "2+2", "correct_answer": "4"}
_MINIMAL_OUTPUTS = "4"


# ---------------------------------------------------------------------------
# Thread-offload test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_code_safely_runs_in_thread(monkeypatch):
    """execute_code_safely must be called from a worker thread, not the event loop."""
    called_from_thread_ids = []

    def _fake_execute_code_safely(*args, **kwargs):
        called_from_thread_ids.append(threading.current_thread().ident)
        return 1.0

    monkeypatch.setattr(
        code_handlers,
        "execute_code_safely",
        _fake_execute_code_safely,
    )

    await _auto_custom_code_run_v0(
        parameters=_MINIMAL_PARAMETERS,
        inputs=_MINIMAL_INPUTS,
        outputs=_MINIMAL_OUTPUTS,
    )

    assert len(called_from_thread_ids) == 1
    # The call must have come from a *different* thread than the main thread
    # (which is the event-loop thread in tests).
    assert called_from_thread_ids[0] != threading.main_thread().ident


# ---------------------------------------------------------------------------
# Timeout test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_timeout_raises_custom_code_server_error(monkeypatch):
    """A sandbox call that exceeds the timeout raises CustomCodeServerV0Error."""

    def _fake_execute_code_safely(*args, **kwargs):
        # Block long enough that the 0.05 s test timeout fires.
        import time

        time.sleep(9999)

    monkeypatch.setenv("AGENTA_CODE_EVALUATOR_TIMEOUT", "0.05")
    monkeypatch.setattr(
        code_handlers,
        "execute_code_safely",
        _fake_execute_code_safely,
    )

    with pytest.raises(CustomCodeServerV0Error) as exc_info:
        await _auto_custom_code_run_v0(
            parameters=_MINIMAL_PARAMETERS,
            inputs=_MINIMAL_INPUTS,
            outputs=_MINIMAL_OUTPUTS,
        )

    assert "timed out" in exc_info.value.message.lower()


# ---------------------------------------------------------------------------
# Timeout env-var test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_timeout_env_var_is_respected(monkeypatch):
    """AGENTA_CODE_EVALUATOR_TIMEOUT controls the deadline."""
    # Set a generous timeout so a fast fake call succeeds.
    monkeypatch.setenv("AGENTA_CODE_EVALUATOR_TIMEOUT", "30")

    def _fast_execute(*args, **kwargs):
        return 0.8

    monkeypatch.setattr(code_handlers, "execute_code_safely", _fast_execute)

    result = await _auto_custom_code_run_v0(
        parameters=_MINIMAL_PARAMETERS,
        inputs=_MINIMAL_INPUTS,
        outputs=_MINIMAL_OUTPUTS,
    )

    assert result == {"score": 0.8, "success": True}


# ---------------------------------------------------------------------------
# Normal result passthrough test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_normal_result_passthrough(monkeypatch):
    """A regular execution (no timeout) returns the normalized result."""

    def _fake_execute(*args, **kwargs):
        return 0.75

    monkeypatch.setattr(code_handlers, "execute_code_safely", _fake_execute)

    result = await _auto_custom_code_run_v0(
        parameters=_MINIMAL_PARAMETERS,
        inputs=_MINIMAL_INPUTS,
        outputs=_MINIMAL_OUTPUTS,
    )

    assert result == {"score": 0.75, "success": True}


# ---------------------------------------------------------------------------
# Version-2 interface test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_v2_interface_also_offloaded_to_thread(monkeypatch):
    """Version-2 evaluators are also run off the event loop."""
    called_from = []

    def _fake_execute(*args, **kwargs):
        called_from.append(threading.current_thread().ident)
        return 0.9

    monkeypatch.setattr(code_handlers, "execute_code_safely", _fake_execute)

    params = {
        "code": "def evaluate(inputs, outputs, trace): return 0.9",
        "threshold": 0.5,
        "runtime": "python",
        "version": "2",
    }

    result = await _auto_custom_code_run_v0(
        parameters=params,
        inputs={"q": "test"},
        outputs={"answer": "test"},
    )

    assert len(called_from) == 1
    assert called_from[0] != threading.main_thread().ident
    assert result == {"score": 0.9, "success": True}
