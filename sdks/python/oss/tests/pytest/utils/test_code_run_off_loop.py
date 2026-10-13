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
    DEFAULT_CODE_SANDBOX_WAIT_TIMEOUT,
    get_code_sandbox_timeout,
    get_code_sandbox_wait_timeout,
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
            ("inf", DEFAULT_CODE_SANDBOX_TIMEOUT),
            ("nan", DEFAULT_CODE_SANDBOX_TIMEOUT),
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

    @pytest.mark.parametrize(
        "raw, expected",
        [
            (None, DEFAULT_CODE_SANDBOX_WAIT_TIMEOUT),
            ("", DEFAULT_CODE_SANDBOX_WAIT_TIMEOUT),
            ("0", 0.0),
            ("5", 5.0),
            ("2.5", 2.5),
            ("-1", DEFAULT_CODE_SANDBOX_WAIT_TIMEOUT),
            ("later", DEFAULT_CODE_SANDBOX_WAIT_TIMEOUT),
            ("inf", DEFAULT_CODE_SANDBOX_WAIT_TIMEOUT),
            ("nan", DEFAULT_CODE_SANDBOX_WAIT_TIMEOUT),
        ],
    )
    def test_parse_wait(self, monkeypatch, raw, expected):
        if raw is None:
            monkeypatch.delenv(
                "AGENTA_SERVICES_CODE_SANDBOX_WAIT_TIMEOUT", raising=False
            )
        else:
            monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_WAIT_TIMEOUT", raw)

        assert get_code_sandbox_wait_timeout() == expected

    def test_default_wait_and_run_fit_in_the_api_call_timeout(self):
        # The API gives one service call 60 s, and a run that waited for a slot
        # still gets the full run timeout.
        assert DEFAULT_CODE_SANDBOX_WAIT_TIMEOUT + DEFAULT_CODE_SANDBOX_TIMEOUT < 60


class TestCapacity:
    @pytest.fixture
    def one_slot(self, monkeypatch):
        from concurrent.futures import ThreadPoolExecutor

        executor = ThreadPoolExecutor(max_workers=1)
        monkeypatch.setattr(sandbox, "_SANDBOX_THREADS", 1)
        monkeypatch.setattr(sandbox, "_sandbox_slots", sandbox._SandboxSlots(1))
        monkeypatch.setattr(sandbox, "_sandbox_executor", executor)
        yield
        executor.shutdown(wait=True)

    def test_run_fails_fast_when_wait_is_zero(self, monkeypatch, one_slot):
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_WAIT_TIMEOUT", "0")
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(0.5))

        async def _two_runs():
            first = asyncio.create_task(
                _code_v0(parameters={"code": _CODE}, outputs="x")
            )
            await asyncio.sleep(0.05)
            started = time.monotonic()
            with pytest.raises(CodeV0Error) as exc_info:
                await _code_v0(parameters={"code": _CODE}, outputs="x")
            busy_after = time.monotonic() - started
            return await first, exc_info, busy_after

        first, exc_info, busy_after = asyncio.run(_two_runs())

        assert first == {"score": 1.0, "success": True}
        assert "at capacity" in str(exc_info.value.message)
        # The second run is refused at once, it does not wait for the first.
        assert busy_after < 0.2

    def test_slot_stays_held_until_timed_out_thread_ends(self, monkeypatch, one_slot):
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_WAIT_TIMEOUT", "0")
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_TIMEOUT", "0.1")
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(0.4))

        async def _runs():
            with pytest.raises(CodeV0Error):
                await _code_v0(parameters={"code": _CODE}, outputs="x")
            # The timed-out thread still runs, so its slot is still taken.
            with pytest.raises(CodeV0Error) as busy:
                await _code_v0(parameters={"code": _CODE}, outputs="x")
            await asyncio.sleep(0.5)
            monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(0.0))
            return busy, await _code_v0(parameters={"code": _CODE}, outputs="x")

        busy, result = asyncio.run(_runs())

        assert "at capacity" in str(busy.value.message)
        assert result == {"score": 1.0, "success": True}

    def test_run_waits_for_a_free_slot_then_runs(self, monkeypatch, one_slot):
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_WAIT_TIMEOUT", "2")
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(0.3))

        async def _two_runs():
            first = asyncio.create_task(
                _code_v0(parameters={"code": _CODE}, outputs="x")
            )
            await asyncio.sleep(0.05)
            started = time.monotonic()
            second, ticks = await _count_ticks_while(
                _code_v0(parameters={"code": _CODE}, outputs="x")
            )
            return await first, second, ticks, time.monotonic() - started

        first, second, ticks, elapsed = asyncio.run(_two_runs())

        assert first == {"score": 1.0, "success": True}
        assert second == {"score": 1.0, "success": True}
        # The second run waited for the first one to end, then ran.
        assert elapsed >= 0.4
        # The event loop kept running other tasks while the run waited.
        assert ticks >= 10

    def test_run_fails_after_waiting_past_the_limit(self, monkeypatch, one_slot):
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_WAIT_TIMEOUT", "0.2")
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(1.0))

        async def _two_runs():
            first = asyncio.create_task(
                _code_v0(parameters={"code": _CODE}, outputs="x")
            )
            await asyncio.sleep(0.05)
            started = time.monotonic()
            with pytest.raises(CodeV0Error) as exc_info:
                await _code_v0(parameters={"code": _CODE}, outputs="x")
            waited = time.monotonic() - started
            return await first, exc_info, waited

        first, exc_info, waited = asyncio.run(_two_runs())

        assert first == {"score": 1.0, "success": True}
        assert (
            "Custom code runs are at capacity (1 in progress). Try again later."
            in str(exc_info.value.message)
        )
        assert 0.15 <= waited < 0.8

    def test_timeout_counts_from_the_start_of_the_run(self, monkeypatch, one_slot):
        # Each run takes 0.3 s and the run timeout is 0.5 s. The second run
        # waits about 0.3 s for its slot, so wait plus run is longer than the
        # timeout, and it still succeeds.
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_WAIT_TIMEOUT", "2")
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_TIMEOUT", "0.5")
        monkeypatch.setattr(sandbox, "execute_code_safely", _slow_runner(0.3))

        async def _two_runs():
            started = time.monotonic()
            results = await asyncio.gather(
                _code_v0(parameters={"code": _CODE}, outputs="x"),
                _code_v0(parameters={"code": _CODE}, outputs="x"),
            )
            return results, time.monotonic() - started

        results, elapsed = asyncio.run(_two_runs())

        assert results == [{"score": 1.0, "success": True}] * 2
        assert elapsed > 0.5

    def test_waiters_get_slots_in_arrival_order(self, monkeypatch, one_slot):
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_WAIT_TIMEOUT", "5")
        order = []

        def _run(app_params, inputs, *args, **kwargs):
            time.sleep(0.05)
            order.append(inputs["n"])
            return 1.0

        monkeypatch.setattr(sandbox, "execute_code_safely", _run)

        async def _runs():
            tasks = []
            for n in range(5):
                tasks.append(
                    asyncio.create_task(
                        _code_v0(
                            parameters={"code": _CODE}, inputs={"n": n}, outputs="x"
                        )
                    )
                )
                await asyncio.sleep(0.01)
            return await asyncio.gather(*tasks)

        asyncio.run(_runs())

        assert order == [0, 1, 2, 3, 4]


class TestSandboxSlots:
    def test_cancelled_waiter_does_not_keep_a_slot(self):
        slots = sandbox._SandboxSlots(1)

        async def _flow():
            assert await slots.acquire(0)
            waiter = asyncio.create_task(slots.acquire(5))
            await asyncio.sleep(0.05)
            waiter.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiter
            slots.release()
            # The slot came back to the pool, not to the cancelled waiter.
            return await slots.acquire(0)

        assert asyncio.run(_flow()) is True

    def test_slot_released_from_another_thread_wakes_the_waiter(self):
        import threading

        slots = sandbox._SandboxSlots(1)

        async def _flow():
            assert await slots.acquire(0)
            threading.Timer(0.1, slots.release).start()
            started = time.monotonic()
            got = await slots.acquire(2)
            return got, time.monotonic() - started

        got, waited = asyncio.run(_flow())

        assert got is True
        assert 0.05 <= waited < 1.0

    def test_released_slots_can_be_taken_again(self):
        slots = sandbox._SandboxSlots(2)

        async def _flow():
            assert await slots.acquire(0)
            assert await slots.acquire(0)
            assert not await slots.acquire(0)
            slots.release()
            slots.release()
            assert await slots.acquire(0)
            assert await slots.acquire(0)
            return await slots.acquire(0)

        assert asyncio.run(_flow()) is False

    def test_release_past_the_size_fails(self):
        slots = sandbox._SandboxSlots(1)

        with pytest.raises(ValueError):
            slots.release()
