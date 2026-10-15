"""Pins the socket timeout and health check on the durable Redis streams client.

When a managed Redis fails over, an open connection can stop answering without
being closed. With no socket timeout the call on it waits forever, retries never
run, and the stream workers stop consuming until the pod restarts.

These tests assert the client options, that both places that build a streams
client use them, and (against a local server that accepts a connection and never
answers) that a silent connection raises instead of hanging.
"""

import asyncio
import inspect
from pathlib import Path
from types import SimpleNamespace

import pytest
from redis.exceptions import TimeoutError as RedisTimeoutError

from oss.src.dbs.redis.shared import engine as engine_module
from oss.src.dbs.redis.shared.engine import (
    STREAMS_HEALTH_CHECK_INTERVAL,
    STREAMS_SOCKET_TIMEOUT,
    StreamsEngine,
    streams_client_options,
)
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer


def _uri_durable(monkeypatch, uri):
    monkeypatch.setattr(
        engine_module,
        "env",
        SimpleNamespace(redis=SimpleNamespace(uri_durable=uri)),
    )


def test_socket_timeout_outlasts_the_blocking_read():
    # XREADGROUP blocks for max_block_ms; a shorter socket timeout would cut it.
    parameters = inspect.signature(StreamConsumer.__init__).parameters
    max_block_ms = parameters["max_block_ms"].default

    assert STREAMS_SOCKET_TIMEOUT * 1000 > max_block_ms


def test_client_options_enable_timeout_health_check_and_keepalive():
    options = streams_client_options()

    assert options["socket_timeout"] == STREAMS_SOCKET_TIMEOUT
    assert options["health_check_interval"] == STREAMS_HEALTH_CHECK_INTERVAL
    assert options["socket_keepalive"] is True


async def test_streams_engine_client_is_built_with_the_options(monkeypatch):
    _uri_durable(monkeypatch, "redis://127.0.0.1:6379/0")
    streams = StreamsEngine()

    try:
        kwargs = streams.get_redis().connection_pool.connection_kwargs
    finally:
        await streams.close()

    assert kwargs["socket_timeout"] == STREAMS_SOCKET_TIMEOUT
    assert kwargs["health_check_interval"] == STREAMS_HEALTH_CHECK_INTERVAL
    assert kwargs["socket_keepalive"] is True


def test_worker_streams_client_uses_the_shared_options():
    # The worker used to pass socket_timeout=None explicitly. Reading the source
    # keeps this test from importing the whole entrypoint.
    worker = Path(__file__).parents[4] / "entrypoints" / "worker_streams.py"
    source = worker.read_text()

    assert "socket_timeout=None" not in source
    assert "**streams_client_options()" in source


async def test_silent_connection_times_out_instead_of_hanging(monkeypatch):
    async def _accept_and_never_answer(reader, writer):
        try:
            await reader.read()  # until the client closes
        finally:
            writer.close()

    server = await asyncio.start_server(_accept_and_never_answer, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]

    monkeypatch.setattr(engine_module, "STREAMS_SOCKET_TIMEOUT", 0.2)
    _uri_durable(monkeypatch, f"redis://127.0.0.1:{port}/0")
    streams = StreamsEngine()

    try:
        client = streams.get_redis()
        # Must fail fast: redis-py 8 gives up after 5s by default and a worker with
        # socket_timeout=None never does. wait_for(2) sits between the patched 0.2s
        # and those, so only the fix passes; otherwise this raises
        # asyncio.TimeoutError instead.
        with pytest.raises(RedisTimeoutError):
            await asyncio.wait_for(client.ping(), timeout=2)
    finally:
        await streams.close()
        server.close()
        await server.wait_closed()
