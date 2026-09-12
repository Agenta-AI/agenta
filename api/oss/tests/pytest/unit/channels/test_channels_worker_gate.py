"""The channels deployment flag gates the consumers, not only the producer.

`AGENTA_CHANNELS_ENABLED=false` stops the API from enqueueing, and it must
also stop the inbox and outbox consumers from draining what is already
queued, or a disabled deployment keeps invoking agents and posting answers.
"""

from entrypoints import worker_queues, worker_streams
from oss.src.utils.env import env


def test_channels_inbox_is_not_consumed_when_channels_are_disabled(monkeypatch):
    monkeypatch.setattr(env.agenta.workers, "queues", [])
    monkeypatch.setattr(env.channels, "enabled", False)

    selected = worker_queues._selected_queues()

    assert "channels-inbox" not in selected
    assert set(selected) == set(worker_queues.ALL_QUEUES) - {"channels-inbox"}


def test_channels_inbox_is_consumed_when_channels_are_enabled(monkeypatch):
    monkeypatch.setattr(env.agenta.workers, "queues", ["channels-inbox"])
    monkeypatch.setattr(env.channels, "enabled", True)

    assert worker_queues._selected_queues() == ["channels-inbox"]


def test_channels_outbox_is_not_consumed_when_channels_are_disabled(monkeypatch):
    monkeypatch.setattr(env.agenta.workers, "streams", ["records", "sessions"])
    monkeypatch.setattr(env.channels, "enabled", False)

    assert worker_streams._selected_streams() == ["records"]


def test_channels_outbox_is_consumed_when_channels_are_enabled(monkeypatch):
    monkeypatch.setattr(env.agenta.workers, "streams", [])
    monkeypatch.setattr(env.channels, "enabled", True)

    assert worker_streams._selected_streams() == list(worker_streams.ALL_STREAMS)
