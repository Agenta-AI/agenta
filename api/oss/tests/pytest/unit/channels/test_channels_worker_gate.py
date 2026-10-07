"""Channels starts without an environment feature gate; worker selection still applies."""

import ast
from pathlib import Path

import pytest
from entrypoints import worker_queues, worker_streams
from oss.src.utils.env import ChannelsConfig, env


@pytest.mark.parametrize("legacy_value", [None, "false", "true"])
def test_channels_workers_are_selected_by_default(monkeypatch, legacy_value):
    if legacy_value is None:
        monkeypatch.delenv("AGENTA_CHANNELS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("AGENTA_CHANNELS_ENABLED", legacy_value)
    monkeypatch.setattr(env.agenta.workers, "queues", [])
    monkeypatch.setattr(env.agenta.workers, "streams", [])

    assert not hasattr(ChannelsConfig(), "enabled")
    assert worker_queues._selected_queues() == list(worker_queues.ALL_QUEUES)
    assert "channels-inbox" in worker_queues._selected_queues()
    assert worker_streams._selected_streams() == list(worker_streams.ALL_STREAMS)
    assert "sessions" in worker_streams._selected_streams()


@pytest.mark.parametrize("selected", [["channels-inbox"], ["triggers"]])
def test_explicit_queue_selection_is_preserved(monkeypatch, selected):
    monkeypatch.setattr(env.agenta.workers, "queues", selected)
    assert worker_queues._selected_queues() == selected


@pytest.mark.parametrize("selected", [["sessions"], ["records"]])
def test_explicit_stream_selection_is_preserved(monkeypatch, selected):
    monkeypatch.setattr(env.agenta.workers, "streams", selected)
    assert worker_streams._selected_streams() == selected


def test_channels_routes_and_broker_are_not_conditional():
    source = Path(worker_queues.__file__).with_name("routers.py").read_text()
    tree = ast.parse(source)
    registrations = [
        node.value
        for node in tree.body
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Attribute)
        and node.value.func.attr == "include_router"
        and any(
            keyword.arg == "router"
            and ast.unparse(keyword.value)
            in {"channels.router", "channels_ingress.router"}
            for keyword in node.value.keywords
        )
    ]
    assert len(registrations) == 4
    lifespan = next(
        node
        for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "lifespan"
    )
    calls = {
        ast.unparse(node.value)
        for node in lifespan.body
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Await)
    }
    assert "await _channels_inbox_broker.startup()" in calls
    assert "await _channels_inbox_broker.shutdown()" in calls
