from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.evaluations import utils as evaluation_utils
from oss.src.core.tracing.dtos import OTelSpan


@pytest.mark.asyncio
async def test_fetch_trace_retries_until_trace_has_usable_root_span(monkeypatch):
    project_id = uuid4()
    trace_id = uuid4().hex
    root_span = OTelSpan(
        trace_id=trace_id,
        span_id=uuid4().hex[:16],
        span_name="root",
    )
    responses = [
        SimpleNamespace(trace_id=trace_id, spans=None),
        SimpleNamespace(trace_id=trace_id, spans={}),
        SimpleNamespace(trace_id=trace_id, spans={"root": root_span}),
    ]
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleep_calls.append(delay)

    class DummyTracingService:
        def __init__(self) -> None:
            self.calls = 0

        async def fetch_trace(self, *, project_id, trace_id):
            assert project_id == project_id_value
            assert trace_id == trace_id_value
            response = responses[self.calls]
            self.calls += 1
            return response

    project_id_value = project_id
    trace_id_value = trace_id
    tracing_service = DummyTracingService()

    monkeypatch.setattr(evaluation_utils, "sleep", fake_sleep)

    fetched = await evaluation_utils.fetch_trace(
        tracing_service=tracing_service,
        project_id=project_id,
        trace_id=trace_id,
        max_retries=5,
        delay=0.5,
        max_delay=2.0,
    )

    assert fetched is not None
    assert fetched.spans == {"root": root_span}
    assert tracing_service.calls == 3
    assert sleep_calls == [0.5, 1.0]


@pytest.mark.asyncio
async def test_fetch_trace_returns_none_when_trace_never_has_root_span(monkeypatch):
    project_id = uuid4()
    trace_id = uuid4().hex
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleep_calls.append(delay)

    class DummyTracingService:
        def __init__(self) -> None:
            self.calls = 0

        async def fetch_trace(self, *, project_id, trace_id):
            self.calls += 1
            return SimpleNamespace(trace_id=trace_id, spans=None)

    tracing_service = DummyTracingService()

    monkeypatch.setattr(evaluation_utils, "sleep", fake_sleep)

    fetched = await evaluation_utils.fetch_trace(
        tracing_service=tracing_service,
        project_id=project_id,
        trace_id=trace_id,
        max_retries=3,
        delay=0.25,
        max_delay=1.0,
    )

    assert fetched is None
    assert tracing_service.calls == 3
    assert sleep_calls == [0.25, 0.5]
