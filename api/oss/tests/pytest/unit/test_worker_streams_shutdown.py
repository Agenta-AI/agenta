"""Pins the graceful-shutdown contract for the worker-streams entrypoint.

`worker_streams.main_async` installs SIGINT/SIGTERM handlers that set an
`asyncio.Event`, then hands the consumers to `run_consumers_until_shutdown`.
Before this, `main_async` only ran a bare `asyncio.gather`, so on SIGTERM (the
signal Docker/Kubernetes/watchmedo send) the process was hard-killed mid-loop,
orphaning the worker and leaving stale consumer-group entries.

These tests drive the supervisor directly rather than raising a real signal:
signal delivery under pytest is flaky, and the event is the seam the handler
sets. They assert the shutdown path cancels the consumer loops and returns 0,
and that a consumer failing on its own still propagates instead of being masked.
"""

import asyncio

import pytest

from oss.src.tasks.asyncio.shared.consumer import run_consumers_until_shutdown


class _BlockingConsumer:
    """Stands in for a StreamConsumer: run() blocks until cancelled, like the
    real read_batch loop parked on a blocking XREADGROUP between messages."""

    def __init__(self):
        self.cancelled = False

    async def run(self):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise


class _FailingConsumer:
    async def run(self):
        raise RuntimeError("boom")


async def test_shutdown_signal_cancels_consumers_and_returns_zero():
    consumers = [_BlockingConsumer(), _BlockingConsumer()]
    shutdown_event = asyncio.Event()

    async def _signal_later():
        await asyncio.sleep(0.02)
        shutdown_event.set()

    trigger = asyncio.create_task(_signal_later())
    return_code = await asyncio.wait_for(
        run_consumers_until_shutdown(consumers, shutdown_event),
        timeout=2,
    )
    await trigger

    assert return_code == 0
    assert all(c.cancelled for c in consumers)


async def test_consumer_failure_propagates_without_shutdown():
    shutdown_event = asyncio.Event()

    with pytest.raises(RuntimeError, match="boom"):
        await asyncio.wait_for(
            run_consumers_until_shutdown([_FailingConsumer()], shutdown_event),
            timeout=2,
        )

    assert not shutdown_event.is_set()
