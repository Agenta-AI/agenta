"""Trace totals: the worker recomputes every trace a batch touched, and the DAO recompute.

The DAO runs against a fake session that records statements.
"""

import json
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from oss.src.core.shared.dtos import RunUsage
from oss.src.core.tracing.dtos import OTelFlatSpan, SpanType
from oss.src.core.tracing.streaming import serialize_span
from oss.src.core.tracing.utils.trees import (
    calculate_and_propagate_metrics_by_trace,
    recompute_cumulative_metrics,
)
from oss.src.dbs.postgres.tracing.dao import (
    UPDATE_CUMULATIVE_METRIC_STMT,
    TracingDAO,
)
from oss.src.tasks.asyncio.tracing import worker as worker_module
from oss.src.tasks.asyncio.tracing.worker import TracingWorker

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


# --- worker ------------------------------------------------------------------


class _StoringService:
    """Stores spans like ingest does and recomputes over everything stored."""

    def __init__(self, recompute_failures=0):
        self.spans = {}
        self.recomputed = []
        self.recompute_failures = recompute_failures

    async def ingest(self, *, project_id, user_id, span_dtos):
        for span_dto in calculate_and_propagate_metrics_by_trace(span_dtos):
            self.spans[span_dto.span_id] = deepcopy(span_dto)

    async def recompute_trace_totals(self, *, project_id, trace_id, on_root_usage=None):
        self.recomputed.append((project_id, trace_id))
        if self.recompute_failures:
            self.recompute_failures -= 1
            raise RuntimeError("db down")
        changes = recompute_cumulative_metrics(
            [deepcopy(span) for span in self.spans.values()]
        )
        for span_id, metrics in changes.items():
            for metric, value in metrics.items():
                node = (
                    self.spans[span_id]
                    .attributes["ag"]["metrics"]
                    .setdefault(metric, {})
                )
                if value is None:
                    node.pop("cumulative", None)
                else:
                    node["cumulative"] = value
        return len(changes)


def _span(trace_id, span_id, parent_id, offset_s, cost=None):
    metrics = {"costs": {"incremental": {"total": cost}}} if cost is not None else {}
    return OTelFlatSpan(
        trace_id=str(trace_id),
        span_id=str(span_id),
        parent_id=str(parent_id) if parent_id else None,
        span_type=SpanType.CHAT if cost is not None else SpanType.TASK,
        span_name="s",
        start_time=T0 + timedelta(seconds=offset_s),
        end_time=T0 + timedelta(seconds=offset_s),
        attributes={"ag": {"metrics": metrics}},
    )


def _message(ids, span_dto):
    return (uuid4().hex.encode(), {b"data": serialize_span(**ids, span_dto=span_dto)})


class _Turns:
    def __init__(self, failures=0):
        self.written = []
        self.failures = failures

    async def set_turn_usage_from_trace(self, *, project_id, trace_id, usage):
        if self.failures:
            self.failures -= 1
            raise ConnectionError("core database down")
        self.written.append((project_id, trace_id, usage))
        return 1


def _worker(service, turns=None):
    return TracingWorker(
        service=service,
        turns_service=turns or _Turns(),
        redis_client=None,
        stream_name="streams:spans",
        consumer_group="worker-spans",
        consumer_name="test",
    )


def _root_cost(service, root_id):
    metrics = service.spans[str(root_id)].attributes["ag"]["metrics"]
    return metrics.get("costs", {}).get("cumulative", {}).get("total")


async def test_trace_split_across_requests_gets_its_full_totals():
    service = _StoringService()
    worker = _worker(service)
    ids = dict(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())
    trace_id, root_id, agent_id = uuid4(), uuid4(), uuid4()

    # The SDK request carries the workflow root; the runner request its subtree.
    await worker.process_batch([_message(ids, _span(trace_id, root_id, None, 0))])
    await worker.process_batch(
        [
            _message(ids, _span(trace_id, agent_id, root_id, 1)),
            _message(ids, _span(trace_id, uuid4(), agent_id, 2, cost=0.01)),
            _message(ids, _span(trace_id, uuid4(), agent_id, 3, cost=0.02)),
        ]
    )

    assert service.recomputed == [(ids["project_id"], trace_id)] * 2
    assert _root_cost(service, root_id) == pytest.approx(0.03)


async def test_a_transient_recompute_failure_is_retried(monkeypatch):
    monkeypatch.setattr(worker_module, "RECOMPUTE_BACKOFF_S", 0)
    service = _StoringService()
    worker = _worker(service)
    ids = dict(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())
    trace_id, root_id = uuid4(), uuid4()

    await worker.process_batch([_message(ids, _span(trace_id, root_id, None, 0))])
    service.recompute_failures = 1
    await worker.process_batch(
        [_message(ids, _span(trace_id, uuid4(), root_id, 1, cost=0.03))]
    )

    assert service.recomputed == [(ids["project_id"], trace_id)] * 3
    assert _root_cost(service, root_id) == pytest.approx(0.03)


async def test_a_failed_recompute_does_not_hold_back_the_batch(monkeypatch):
    monkeypatch.setattr(worker_module, "RECOMPUTE_BACKOFF_S", 0)
    service = _StoringService(recompute_failures=worker_module.RECOMPUTE_ATTEMPTS)
    worker = _worker(service)
    ids = dict(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())
    message = _message(ids, _span(uuid4(), uuid4(), None, 0, cost=0.01))

    count, acked = await worker.process_batch([message])

    assert (count, acked) == (1, [message[0]])
    assert len(service.spans) == 1
    assert len(service.recomputed) == worker_module.RECOMPUTE_ATTEMPTS


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
        self.engine.executed.append(("COMMIT", None))


class _Engine:
    def __init__(self, rows):
        self.rows = rows
        self.executed = []

    @asynccontextmanager
    async def session(self):
        yield _Session(self)


def _row(span_id, parent_id, span_type, offset_s, metrics, flags=None):
    return SimpleNamespace(
        span_id=span_id,
        parent_id=parent_id,
        span_type=span_type,
        start_time=T0 + timedelta(seconds=offset_s),
        end_time=T0 + timedelta(seconds=offset_s),
        metrics=metrics,
        flags=flags,
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
    update_stmt, params = engine.executed[-2]
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


async def test_dao_hands_on_the_root_usage_before_the_commit():
    root, child = UUID(int=2), UUID(int=1)
    rows = [
        _row(root, None, SpanType.WORKFLOW, 0, None),
        _row(
            child,
            root,
            SpanType.CHAT,
            1,
            {
                "costs": {"incremental": {"total": 0.02}},
                "tokens": {"incremental": {"prompt": 10, "completion": 5}},
            },
        ),
    ]
    engine = _Engine(rows)
    seen = []

    async def on_root_usage(usage):
        assert ("COMMIT", None) not in engine.executed
        seen.append(usage)

    await TracingDAO(engine=engine).recompute_trace_metrics(
        project_id=uuid4(),
        trace_id=uuid4(),
        recompute=recompute_cumulative_metrics,
        max_spans=10,
        on_root_usage=on_root_usage,
    )

    assert len(seen) == 1
    usage = seen[0]
    assert (usage.input_tokens, usage.output_tokens, usage.total_tokens) == (10, 5, 15)
    assert usage.cost == pytest.approx(0.02)
    assert engine.executed[-1] == ("COMMIT", None)


async def test_dao_hands_on_nothing_for_a_trace_without_usage():
    seen = []

    async def on_root_usage(usage):
        seen.append(usage)

    await TracingDAO(
        engine=_Engine([_row(UUID(int=1), None, SpanType.WORKFLOW, 0, None)])
    ).recompute_trace_metrics(
        project_id=uuid4(),
        trace_id=uuid4(),
        recompute=recompute_cumulative_metrics,
        max_spans=10,
        on_root_usage=on_root_usage,
    )

    assert seen == []


class _UsageService(_StoringService):
    """Hands a fixed root usage on, as the DAO does for a priced trace."""

    def __init__(self, usage):
        super().__init__()
        self.usage = usage

    async def recompute_trace_totals(self, *, project_id, trace_id, on_root_usage=None):
        await super().recompute_trace_totals(project_id=project_id, trace_id=trace_id)
        if self.usage is not None and on_root_usage is not None:
            await on_root_usage(self.usage)
        return 0


async def test_a_priced_trace_writes_its_root_usage_to_the_turn():
    turns = _Turns()
    usage = RunUsage(input_tokens=3, output_tokens=4, total_tokens=7, cost=0.5)
    worker = _worker(_UsageService(usage), turns)
    ids = dict(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())
    trace_id = uuid4()

    await worker.process_batch([_message(ids, _span(trace_id, uuid4(), None, 0))])

    assert turns.written == [(ids["project_id"], trace_id, usage)]


async def test_an_unpriced_trace_writes_no_turn():
    turns = _Turns()
    worker = _worker(_UsageService(None), turns)
    ids = dict(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())

    await worker.process_batch([_message(ids, _span(uuid4(), uuid4(), None, 0))])

    assert turns.written == []


async def test_a_failed_usage_write_is_retried_with_the_recompute(monkeypatch):
    monkeypatch.setattr(worker_module, "RECOMPUTE_BACKOFF_S", 0)
    turns = _Turns(failures=1)
    usage = RunUsage(cost=0.5)
    service = _UsageService(usage)
    worker = _worker(service, turns)
    ids = dict(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())
    trace_id = uuid4()

    await worker.process_batch([_message(ids, _span(trace_id, uuid4(), None, 0))])

    assert len(service.recomputed) == 2
    assert turns.written == [(ids["project_id"], trace_id, usage)]
