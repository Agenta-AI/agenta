from unittest.mock import patch

import pytest
import requests
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SpanExportResult, SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from agenta.sdk.engines.tracing import exporters
from agenta.sdk.engines.tracing.exporters import OTLPExporter
from agenta.sdk.utils.cache import TTLLRUCache


def _make_spans():
    memory = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource.create({}))
    provider.add_span_processor(SimpleSpanProcessor(memory))
    tracer = provider.get_tracer("test")
    with tracer.start_as_current_span("a"):
        pass
    with tracer.start_as_current_span("b"):
        pass
    spans = memory.get_finished_spans()
    return spans


@pytest.mark.parametrize("async_export", [False, True])
def test_each_credential_group_uses_only_its_own_authorization(
    monkeypatch, async_export
):
    monkeypatch.setattr(exporters, "_ASYNC_EXPORT", async_export)

    spans = _make_spans()
    credentials = TTLLRUCache()
    credentials.put(spans[0].get_span_context().trace_id, "ApiKey one")
    credentials.put(spans[1].get_span_context().trace_id, "ApiKey two")

    sent = []

    def fake_request(self, method, url, *args, **kwargs):
        sent.append(dict(kwargs.get("headers") or {}))
        response = requests.Response()
        response.status_code = 200
        return response

    with patch.object(requests.Session, "request", fake_request):
        exporter = OTLPExporter(
            endpoint="http://localhost:1/v1/traces",
            headers={"X-Static": "yes"},
            credentials=credentials,
        )
        result = exporter.export(spans)
        if async_export:
            import threading

            for t in threading.enumerate():
                if t is not threading.current_thread() and not t.daemon:
                    t.join(5)

    assert result == SpanExportResult.SUCCESS
    assert sorted(h["Authorization"] for h in sent) == ["ApiKey one", "ApiKey two"]
    assert all(h.get("x-static") == "yes" for h in sent)


def test_shutdown_waits_for_pending_async_groups(monkeypatch):
    monkeypatch.setattr(exporters, "_ASYNC_EXPORT", True)

    spans = _make_spans()
    sent = []

    def slow_request(self, method, url, *args, **kwargs):
        import time

        time.sleep(0.5)
        sent.append(1)
        response = requests.Response()
        response.status_code = 200
        return response

    with patch.object(requests.Session, "request", slow_request):
        exporter = OTLPExporter(endpoint="http://localhost:1/v1/traces")
        exporter.export(spans)
        exporter.shutdown()

    assert sent
