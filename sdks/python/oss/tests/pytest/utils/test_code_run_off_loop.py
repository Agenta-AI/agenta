"""
Unit tests for running custom code evaluators off the event loop.

The code runners are synchronous. The Daytona runner blocks for tens of
seconds per run. These tests check that the async evaluator handlers run the
code in a worker thread, so the event loop keeps serving other work, and that
a hard timeout turns a slow run into an evaluator error.
"""

import asyncio
import time

import pytest

from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.engines.running import sandbox
from agenta.sdk.engines.running.errors import CodeV0Error, CustomCodeServerV0Error
from agenta.sdk.engines.running.handlers import auto_custom_code_run_v0, code_v0
from agenta.sdk.engines.running.runners.base import (
    DEFAULT_CODE_SANDBOX_TIMEOUT,
    get_code_sandbox_timeout,
)

_code_v0 = code_v0.__wrapped__
_auto_custom_code_run_v0 = auto_custom_code_run_v0.__wrapped__

_CODE = "def evaluate(inputs, outputs, trace):\n    return 1.0\n"


def _slow_runner(seconds: float, result: float = 1.0):
    def _run(*args, **kwargs):
        time.sleep(seconds)
        return result

    return _run


async def _count_ticks_while(coro, interval: float = 0.02):
    """Run `coro` and count how often another task gets the loop meanwhile."""
    ticks = 0
    done = asyncio.Event()

    async def _ticker():
        nonlocal ticks
        while not done.is_set():
            await asyncio.sleep(interval)
            ticks += 1

    ticker = asyncio.create_task(_ticker())
    try:
        result = await coro
    finally:
        done.set()
        await ticker
    return result, ticks


class TestEventLoopStaysResponsive:
    def test_code_v0_does_not_block_loop(self, monkeypatch):
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(0.5))

        result, ticks = asyncio.run(
            _count_ticks_while(_code_v0(parameters={"code": _CODE}, outputs="x"))
        )

        assert result == {"score": 1.0, "success": True}
        # A blocked loop gives the ticker no turn at all during the 0.5 s run.
        assert ticks >= 10

    def test_auto_custom_code_run_v0_does_not_block_loop(self, monkeypatch):
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(0.5))

        result, ticks = asyncio.run(
            _count_ticks_while(
                _auto_custom_code_run_v0(
                    parameters={"code": _CODE, "version": "2", "threshold": 0.5},
                    inputs={},
                    outputs="x",
                )
            )
        )

        assert result == {"score": 1.0, "success": True}
        assert ticks >= 10

    def test_parallel_runs_overlap(self, monkeypatch):
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(0.5))

        async def _two_runs():
            return await asyncio.gather(
                _code_v0(parameters={"code": _CODE}, outputs="x"),
                _code_v0(parameters={"code": _CODE}, outputs="x"),
            )

        started = time.monotonic()
        results = asyncio.run(_two_runs())
        elapsed = time.monotonic() - started

        assert results == [{"score": 1.0, "success": True}] * 2
        # Serial runs on a blocked loop would take at least 1.0 s.
        assert elapsed < 0.9

    def test_running_context_reaches_worker_thread(self, monkeypatch):
        # The Daytona runner reads the credentials from RunningContext.
        seen = {}

        def _run(*args, **kwargs):
            seen["credentials"] = RunningContext.get().credentials
            return 1.0

        monkeypatch.setattr(sandbox, "execute_code_safely", _run)

        async def _with_context():
            token = RunningContext.set(RunningContext(credentials="ApiKey abc"))
            try:
                return await _code_v0(parameters={"code": _CODE}, outputs="x")
            finally:
                RunningContext.reset(token)

        asyncio.run(_with_context())

        assert seen["credentials"] == "ApiKey abc"


class TestTimeout:
    def test_code_v0_times_out_with_evaluator_error(self, monkeypatch):
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_TIMEOUT", "0.2")
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(1.0))

        async def _timed():
            # Measured inside the loop: asyncio.run() itself waits for the
            # abandoned worker thread at shutdown, a long-lived server does not.
            started = time.monotonic()
            with pytest.raises(CodeV0Error) as exc_info:
                await _code_v0(parameters={"code": _CODE}, outputs="x")
            return exc_info, time.monotonic() - started

        exc_info, elapsed = asyncio.run(_timed())

        assert "timed out after 0.2s" in str(exc_info.value.message)
        assert elapsed < 0.9

    def test_auto_custom_code_run_v0_times_out_with_evaluator_error(self, monkeypatch):
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_TIMEOUT", "0.2")
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(1.0))

        with pytest.raises(CustomCodeServerV0Error) as exc_info:
            asyncio.run(
                _auto_custom_code_run_v0(
                    parameters={"code": _CODE, "version": "2", "threshold": 0.5},
                    inputs={},
                    outputs="x",
                )
            )

        assert "timed out after 0.2s" in str(exc_info.value.message)


class TestTimeoutSetting:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            (None, DEFAULT_CODE_SANDBOX_TIMEOUT),
            ("", DEFAULT_CODE_SANDBOX_TIMEOUT),
            ("20", 20.0),
            ("2.5", 2.5),
            ("0", DEFAULT_CODE_SANDBOX_TIMEOUT),
            ("-3", DEFAULT_CODE_SANDBOX_TIMEOUT),
            ("soon", DEFAULT_CODE_SANDBOX_TIMEOUT),
        ],
    )
    def test_parse(self, monkeypatch, raw, expected):
        if raw is None:
            monkeypatch.delenv("AGENTA_SERVICES_CODE_SANDBOX_TIMEOUT", raising=False)
        else:
            monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_TIMEOUT", raw)

        assert get_code_sandbox_timeout() == expected

    def test_default_is_below_gunicorn_worker_timeout(self):
        # The services deployment runs gunicorn with --timeout 60.
        assert DEFAULT_CODE_SANDBOX_TIMEOUT < 60
