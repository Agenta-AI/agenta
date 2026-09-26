"""Trace totals scheduling (worker + Redis) and the DAO recompute, without a live DB.

Redis is fakeredis; the DAO runs against a fake session that records statements.
"""

import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import fakeredis.aioredis as fakeredis
import pytest

from oss.src.core.tracing.dtos import OTelFlatSpan, SpanType
from oss.src.core.tracing.streaming import deserialize_span, serialize_span
from oss.src.core.tracing.totals import (
    TOTALS_QUEUE_KEY,
    claim_due_trace_totals,
    schedule_trace_totals,
)
from oss.src.core.tracing.utils.trees import recompute_cumulative_metrics
from oss.src.dbs.postgres.tracing.dao import (
    UPDATE_CUMULATIVE_METRIC_STMT,
    TracingDAO,
)
from oss.src.tasks.asyncio.tracing.worker import TracingWorker

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


# --- scheduling --------------------------------------------------------------


async def test_a_trace_from_one_request_is_not_scheduled():
    redis = fakeredis.FakeRedis()
    key = (uuid4(), uuid4())

    assert (
        await schedule_trace_totals(redis, batches_by_trace={key: {"a"}}, delay_ms=0)
        == 0
    )
    assert (
        await schedule_trace_totals(redis, batches_by_trace={key: {"a"}}, delay_ms=0)
        == 0
    )
    assert await redis.zcard(TOTALS_QUEUE_KEY) == 0


async def test_a_trace_from_two_requests_is_claimed_once_when_due():
    redis = fakeredis.FakeRedis()
    key = (uuid4(), uuid4())

    await schedule_trace_totals(redis, batches_by_trace={key: {"a"}}, delay_ms=60_000)
    assert (
        await schedule_trace_totals(
            redis, batches_by_trace={key: {"b"}}, delay_ms=60_000
        )
        == 1
    )
    assert await claim_due_trace_totals(redis, limit=10) == []

    await redis.zadd(TOTALS_QUEUE_KEY, {f"{key[0].hex}:{key[1].hex}": 0})

    assert await claim_due_trace_totals(redis, limit=10) == [key]
    assert await claim_due_trace_totals(redis, limit=10) == []


async def test_a_busy_trace_keeps_its_first_due_time():
    redis = fakeredis.FakeRedis()
    key = (uuid4(), uuid4())

    await schedule_trace_totals(redis, batches_by_trace={key: {"a", "b"}}, delay_ms=0)
    first = await redis.zscore(TOTALS_QUEUE_KEY, f"{key[0].hex}:{key[1].hex}")
    await schedule_trace_totals(redis, batches_by_trace={key: {"c"}}, delay_ms=60_000)

    assert await redis.zscore(TOTALS_QUEUE_KEY, f"{key[0].hex}:{key[1].hex}") == first


def test_batch_id_round_trips_and_old_messages_have_none():
    span_dto = OTelFlatSpan(
        trace_id=str(uuid4()),
        span_id=str(uuid4()),
        span_name="s",
        start_time=T0,
        end_time=T0,
    )
    ids = dict(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())

    tagged = serialize_span(**ids, span_dto=span_dto, batch_id="abc")
    untagged = serialize_span(**ids, span_dto=span_dto)

    assert deserialize_span(span_bytes=tagged).batch_id == "abc"
    assert deserialize_span(span_bytes=untagged).batch_id is None


# --- worker ------------------------------------------------------------------


class _FakeService:
    def __init__(self):
        self.ingested = []
        self.recomputed = []

    async def ingest(self, *, project_id, user_id, span_dtos):
        self.ingested.extend(span_dtos)

    async def recompute_trace_totals(self, *, project_id, trace_id):
        self.recomputed.append((project_id, trace_id))
        return 1


def _message(ids, trace_id, batch_id):
    span_dto = OTelFlatSpan(
        trace_id=str(trace_id),
        span_id=str(uuid4()),
        parent_id=str(uuid4()),
        span_name="s",
        start_time=T0,
        end_time=T0,
    )
    data = serialize_span(**ids, span_dto=span_dto, batch_id=batch_id)
    return (uuid4().hex.encode(), {b"data": data})


def _worker(redis, service):
    return TracingWorker(
        service=service,
        redis_client=redis,
        stream_name="streams:spans",
        consumer_group="worker-spans",
        consumer_name="test",
        totals_delay_ms=0,
    )


async def test_worker_recomputes_a_trace_split_across_requests():
    redis = fakeredis.FakeRedis()
    service = _FakeService()
    worker = _worker(redis, service)
    ids = dict(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())
    split_trace, whole_trace = uuid4(), uuid4()

    await worker.process_batch(
        [
            _message(ids, split_trace, "request-1"),
            _message(ids, whole_trace, "request-1"),
        ]
    )
    await worker.process_batch([_message(ids, split_trace, "request-2")])

    assert await worker.recompute_due_totals() == 1
    assert service.recomputed == [(ids["project_id"], split_trace)]
    assert await worker.recompute_due_totals() == 0


async def test_worker_skips_messages_without_a_batch_id():
    redis = fakeredis.FakeRedis()
    service = _FakeService()
    worker = _worker(redis, service)
    ids = dict(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())
    trace_id = uuid4()

    await worker.process_batch([_message(ids, trace_id, None)])
    await worker.process_batch([_message(ids, trace_id, None)])

    assert await worker.recompute_due_totals() == 0
    assert len(service.ingested) == 2


# --- DAO ---------------------------------------------------------------------


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Session:
    def __init__(self, engine):
        self.engine = engine

    async def execute(self, stmt, params=None):
        self.engine.executed.append((stmt, params))
        if "SELECT" in str(stmt).upper() and "advisory" not in str(stmt):
            return _Result(self.engine.rows)
        return _Result([])

    async def commit(self):
        pass


class _Engine:
    def __init__(self, rows):
        self.rows = rows
        self.executed = []

    @asynccontextmanager
    async def session(self):
        yield _Session(self)


def _row(span_id, parent_id, span_type, offset_s, metrics):
    return SimpleNamespace(
        span_id=span_id,
        parent_id=parent_id,
        span_type=span_type,
        start_time=T0 + timedelta(seconds=offset_s),
        end_time=T0 + timedelta(seconds=offset_s),
        metrics=metrics,
    )


async def test_dao_writes_only_changed_cumulative_values_in_span_order():
    root, child_b, child_a = (
        UUID(int=3),
        UUID(int=2),
        UUID(int=1),
    )
    rows = [
        _row(root, None, SpanType.WORKFLOW, 0, None),
        _row(
            child_b,
            root,
            SpanType.CHAT,
            1,
            {
                "costs": {
                    "incremental": {"total": 0.02},
                    "cumulative": {"total": 0.02},
                },
            },
        ),
        _row(
            child_a,
            root,
            SpanType.CHAT,
            2,
            {"costs": {"incremental": {"total": 0.01}}},
        ),
    ]
    engine = _Engine(rows)
    project_id, trace_id = uuid4(), uuid4()

    written = await TracingDAO(engine=engine).recompute_trace_metrics(
        project_id=project_id,
        trace_id=trace_id,
        recompute=recompute_cumulative_metrics,
        max_spans=10,
    )

    assert "pg_advisory_xact_lock" in str(engine.executed[0][0])
    update_stmt, params = engine.executed[-1]
    assert update_stmt is UPDATE_CUMULATIVE_METRIC_STMT
    assert written == 2
    assert [(p["span_id"], p["metric"]) for p in params] == [
        (child_a, "costs"),
        (root, "costs"),
    ]
    assert json.loads(params[1]["value"]) == {"total": pytest.approx(0.03)}
    assert all(p["project_id"] == project_id for p in params)


async def test_dao_skips_a_trace_over_the_span_limit():
    rows = [_row(UUID(int=i), None, SpanType.TASK, i, None) for i in range(3)]
    engine = _Engine(rows)

    written = await TracingDAO(engine=engine).recompute_trace_metrics(
        project_id=uuid4(),
        trace_id=uuid4(),
        recompute=recompute_cumulative_metrics,
        max_spans=2,
    )

    assert written is None
    assert len(engine.executed) == 2
