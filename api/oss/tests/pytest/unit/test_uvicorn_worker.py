"""The API's gunicorn worker keeps a draining worker alive and bounds its drain."""

import asyncio
import logging

import pytest
from gunicorn.config import Config as GunicornConfig
from uvicorn.config import Config

from entrypoints import uvicorn_worker
from entrypoints.uvicorn_worker import DrainingUvicornWorker, _DrainingServer


@pytest.mark.asyncio
async def test_draining_server_heartbeats_until_the_drain_ends(monkeypatch):
    monkeypatch.setattr(uvicorn_worker, "DRAIN_HEARTBEAT_SECONDS", 0.01)
    beats = []
    drain_done = asyncio.Event()

    async def _wait_tasks_to_complete(self):
        # An open response that takes a while to finish.
        await asyncio.sleep(0.1)
        drain_done.set()

    monkeypatch.setattr(
        _DrainingServer, "_wait_tasks_to_complete", _wait_tasks_to_complete
    )
    server = _DrainingServer(
        config=Config(app=None, lifespan="off"), heartbeat=lambda: beats.append(1)
    )
    server.servers = []  # never started, so nothing to close
    server.force_exit = True  # skip the lifespan shutdown; no app is loaded

    await server.shutdown()
    beats_at_exit = len(beats)
    await asyncio.sleep(0.05)

    assert drain_done.is_set()
    # The arbiter heard from the worker all through the drain...
    assert beats_at_exit >= 5
    # ...and stops hearing from it once the drain is over.
    assert len(beats) == beats_at_exit


@pytest.mark.asyncio
async def test_heartbeat_stops_after_the_drain_deadline(monkeypatch):
    # A lifespan shutdown that hangs after the drain must not keep the worker looking alive.
    monkeypatch.setattr(uvicorn_worker, "DRAIN_HEARTBEAT_SECONDS", 0.01)
    monkeypatch.setattr(uvicorn_worker, "HEARTBEAT_AFTER_DRAIN_SECONDS", 0.05)
    beats = []
    server = _DrainingServer(
        config=Config(app=None, lifespan="off", timeout_graceful_shutdown=0),
        heartbeat=lambda: beats.append(1),
    )

    await asyncio.wait_for(server._beat(), timeout=1)

    assert 1 <= len(beats) <= 10


def test_worker_bounds_the_drain_by_the_graceful_timeout():
    cfg = GunicornConfig()
    cfg.set("graceful_timeout", 900)

    class _Log:
        error_log = access_log = logging.getLogger("test")

    worker = DrainingUvicornWorker(0, 0, [], None, 30, cfg, _Log())

    assert worker.config.timeout_graceful_shutdown == 900
