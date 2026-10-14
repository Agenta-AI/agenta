"""Server request tracing in the api and its workers (oss.src.utils.server_tracing)."""

from contextlib import nullcontext

import pytest
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import SpanKind, StatusCode
from sqlalchemy import create_engine, text
from taskiq import TaskiqMessage, TaskiqResult

from oss.src.utils import server_tracing
from oss.src.utils.env import env


@pytest.fixture
def off(monkeypatch):
    monkeypatch.setattr(env.agenta.server_tracing, "endpoint", None)


@pytest.fixture
def on(monkeypatch):
    from agenta.sdk.engines.tracing import server

    monkeypatch.setattr(env.agenta.server_tracing, "endpoint", "http://collector:4318")

    exporter = InMemorySpanExporter()
    inner = TracerProvider(
        resource=Resource({"service.name": "agenta-api"}),
        sampler=server.ServerSampler(1.0),
    )
    inner.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(server, "_provider", server._ServerTracerProvider(inner))
    return exporter


def test_everything_is_a_no_op_when_off(off):
    assert not server_tracing.enabled()
    assert not server_tracing.setup_server_tracing("agenta-api")
    assert isinstance(server_tracing.server_span("process records"), nullcontext)
    assert server_tracing.taskiq_middlewares() == []
    server_tracing.instrument_fastapi(object())
    server_tracing.instrument_sqlalchemy(object())


def test_brokers_get_no_middleware_when_off(off):
    from oss.src.tasks.taskiq.shared.broker import ProducerOnlyRedisStreamBroker

    broker = ProducerOnlyRedisStreamBroker(url="redis://localhost:6379/0")

    assert broker.middlewares == []


def test_brokers_get_the_middleware_when_on(on):
    from oss.src.tasks.taskiq.shared.broker import TrimOnAckRedisStreamBroker
    from oss.src.tasks.taskiq.shared.tracing import ServerTracingMiddleware

    broker = TrimOnAckRedisStreamBroker(url="redis://localhost:6379/0")

    assert [type(m) for m in broker.middlewares] == [ServerTracingMiddleware]


def test_stream_batches_get_a_consumer_span(on):
    with server_tracing.server_span(
        "process records", attributes={"messaging.batch.message_count": 3}
    ):
        pass

    (span,) = on.get_finished_spans()
    assert span.name == "process records"
    assert span.kind == SpanKind.CONSUMER
    assert span.attributes["messaging.batch.message_count"] == 3


def _message() -> TaskiqMessage:
    return TaskiqMessage(
        task_id="t1", task_name="evaluations.run", labels={}, args=[], kwargs={}
    )


def test_task_runs_get_a_span_that_parents_their_work(on):
    from oss.src.tasks.taskiq.shared.tracing import ServerTracingMiddleware
    from agenta.sdk.engines.tracing.server import get_server_tracer

    (middleware,) = server_tracing.taskiq_middlewares()
    assert isinstance(middleware, ServerTracingMiddleware)

    message = middleware.pre_execute(_message())
    with get_server_tracer("test").start_as_current_span(
        "SELECT", kind=SpanKind.CLIENT
    ):
        pass
    middleware.post_execute(
        message, TaskiqResult(is_err=False, return_value=None, execution_time=0.1)
    )

    spans = {span.name: span for span in on.get_finished_spans()}
    run, query = spans["run evaluations.run"], spans["SELECT"]
    assert run.kind == SpanKind.CONSUMER
    assert run.attributes["taskiq.task_name"] == "evaluations.run"
    assert query.parent.span_id == run.context.span_id


def test_failed_task_runs_are_marked(on):
    (middleware,) = server_tracing.taskiq_middlewares()

    message = middleware.pre_execute(_message())
    error = ValueError("tenant data")
    result = TaskiqResult(
        is_err=True, return_value=None, execution_time=0.1, error=error
    )
    middleware.on_error(message, result, error)
    middleware.post_execute(message, result)

    (run,) = on.get_finished_spans()
    assert run.status.status_code == StatusCode.ERROR
    assert run.attributes["error.type"] == "ValueError"
    assert "tenant data" not in str(dict(run.attributes))


def test_sqlalchemy_statements_are_traced(on):
    from agenta.sdk.engines.tracing.server import get_server_tracer

    engine = create_engine("sqlite://")
    server_tracing.instrument_sqlalchemy(engine)

    with get_server_tracer("test").start_as_current_span(
        "GET /workflows", kind=SpanKind.SERVER
    ):
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

    spans = {span.kind: span for span in on.get_finished_spans()}
    query, request = spans[SpanKind.CLIENT], spans[SpanKind.SERVER]
    assert query.attributes["db.statement"] == "SELECT 1"
    assert query.parent.span_id == request.context.span_id
