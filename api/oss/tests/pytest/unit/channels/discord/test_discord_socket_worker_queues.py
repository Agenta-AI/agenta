"""worker-queues runs the Discord socket loop only when channels-inbox is
selected, with the channels-inbox service, and stops it on shutdown."""

import asyncio

import pytest

from entrypoints import worker_queues


class _FakeLoop:
    started = []

    def __init__(self, *, channels_service):
        self.channels_service = channels_service

    async def run(self, shutdown):
        _FakeLoop.started.append(self.channels_service)
        await shutdown.wait()


async def _idle_ticker(**_):
    await asyncio.Event().wait()


@pytest.fixture
def harness(monkeypatch):
    _FakeLoop.started = []
    service = object()
    shutdown_events = []

    def _builder():
        return object(), 1

    def _inbox_builder():
        worker_queues._channels_inbox_service = service
        return object(), 1

    async def _receiver(name, broker, max_async_tasks, shutdown):
        shutdown_events.append(shutdown)
        # Stands in for SIGTERM once every sibling has started.
        await asyncio.sleep(0.01)
        shutdown.set()

    builders = {name: _builder for name in worker_queues.ALL_QUEUES}
    builders["channels-inbox"] = _inbox_builder
    monkeypatch.setattr(worker_queues, "_BUILDERS", builders)
    monkeypatch.setattr(worker_queues, "_run_receiver", _receiver)
    monkeypatch.setattr(worker_queues, "DiscordSocketLoop", _FakeLoop)
    monkeypatch.setattr(worker_queues, "warn_deprecated_env_vars", lambda: None)
    monkeypatch.setattr(worker_queues, "validate_required_env_vars", lambda: None)
    monkeypatch.setattr(worker_queues, "is_ee", lambda: False)
    monkeypatch.setattr(worker_queues, "bootstrap_access", lambda: None)
    monkeypatch.setattr(worker_queues.heartbeat, "ticker", _idle_ticker)
    return service


@pytest.mark.parametrize(
    "selected", [[], ["channels-inbox"], ["triggers", "channels-inbox"]]
)
async def test_loop_starts_with_channels_inbox(monkeypatch, harness, selected):
    monkeypatch.setattr(worker_queues.env.agenta.workers, "queues", selected)

    assert await worker_queues.main_async() == 0

    assert _FakeLoop.started == [harness]


async def test_loop_does_not_start_without_channels_inbox(monkeypatch, harness):
    monkeypatch.setattr(worker_queues.env.agenta.workers, "queues", ["triggers"])

    assert await worker_queues.main_async() == 0

    assert _FakeLoop.started == []
