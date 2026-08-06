import logging

import pytest
from redis.exceptions import RedisError

from oss.src.utils.throttling import (
    Algorithm,
    FailureMode,
    check_throttle,
    check_throttles,
)


@pytest.mark.asyncio
async def test_check_throttle_fails_open_on_redis_error(monkeypatch, caplog):
    async def _raise(*args, **kwargs):
        raise RedisError("redis down")

    monkeypatch.setattr("oss.src.utils.throttling.execute_gcra", _raise)

    with caplog.at_level(logging.WARNING):
        result = await check_throttle(
            "global",
            10,
            1,
            algorithm=Algorithm.GCRA,
            failure_mode=FailureMode.OPEN,
        )

    assert result.allow is True
    assert result.tokens_remaining is None
    assert result.retry_after_ms is None
    assert not any(record.levelno >= logging.ERROR for record in caplog.records)


@pytest.mark.asyncio
async def test_check_throttle_fails_closed_on_redis_error(monkeypatch, caplog):
    async def _raise(*args, **kwargs):
        raise RedisError("redis down")

    monkeypatch.setattr("oss.src.utils.throttling.execute_gcra", _raise)

    with caplog.at_level(logging.WARNING):
        result = await check_throttle(
            "global",
            10,
            1,
            algorithm=Algorithm.GCRA,
            failure_mode=FailureMode.CLOSED,
        )

    assert result.allow is False
    assert result.tokens_remaining is None
    assert result.retry_after_ms is None
    assert not any(record.levelno >= logging.ERROR for record in caplog.records)


@pytest.mark.asyncio
async def test_check_throttles_fails_open_on_redis_error(monkeypatch, caplog):
    async def _raise(*args, **kwargs):
        raise RedisError("redis down")

    monkeypatch.setattr("oss.src.utils.throttling._execute_batch_pipeline", _raise)

    with caplog.at_level(logging.WARNING):
        results = await check_throttles(
            [
                ("global", 10, 1),
                ({"org": "abc123"}, 5, 1),
            ],
            algorithm=Algorithm.GCRA,
            failure_mode=FailureMode.OPEN,
        )

    assert [result.allow for result in results] == [True, True]
    assert all(result.tokens_remaining is None for result in results)
    assert all(result.retry_after_ms is None for result in results)
    assert not any(record.levelno >= logging.ERROR for record in caplog.records)
