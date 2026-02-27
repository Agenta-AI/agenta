"""E2E tests for Vercel AI SDK adapter via OTLP ingestion.

These tests send spans with Vercel AI SDK-style `ai.*` attributes through
the OTLP protobuf endpoint, then query back via the REST API and verify
the adapter mapped them to `ag.*` attributes correctly.

Requires a running Agenta instance. Set environment variables:
  AGENTA_API_URL=http://localhost:8480
  AGENTA_AUTH_KEY=<admin auth key>

Run:
  pytest oss/tests/pytest/e2e/tracing/test_vercelai_ingestion.py -v -k vercelai
"""

import time
from json import dumps
from uuid import uuid4

import requests

from utils.polling import wait_for_response


def _build_otlp_protobuf(
    trace_id_hex: str,
    spans: list[dict],
) -> bytes:
    """Build a minimal OTLP ExportTraceServiceRequest protobuf.

    Uses the opentelemetry-proto library to construct a valid protobuf
    that the OTLP endpoint can parse.
    """
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
        ExportTraceServiceRequest,
    )
    from opentelemetry.proto.trace.v1.trace_pb2 import (
        ResourceSpans,
        ScopeSpans,
        Span,
    )
    from opentelemetry.proto.common.v1.common_pb2 import (
        AnyValue,
        KeyValue,
        InstrumentationScope,
    )
    from opentelemetry.proto.resource.v1.resource_pb2 import Resource

    def _to_any_value(v) -> AnyValue:
        if isinstance(v, str):
            return AnyValue(string_value=v)
        elif isinstance(v, bool):
            return AnyValue(bool_value=v)
        elif isinstance(v, int):
            return AnyValue(int_value=v)
        elif isinstance(v, float):
            return AnyValue(double_value=v)
        else:
            return AnyValue(string_value=str(v))

    def _make_kv(key: str, value) -> KeyValue:
        return KeyValue(key=key, value=_to_any_value(value))

    trace_id_bytes = bytes.fromhex(trace_id_hex)

    proto_spans = []
    for span_def in spans:
        span_id_bytes = bytes.fromhex(span_def["span_id"])
        parent_bytes = bytes.fromhex(span_def.get("parent_id", "0" * 16))

        attrs = [_make_kv(k, v) for k, v in span_def.get("attributes", {}).items()]

        # Convert seconds to nanoseconds
        start_ns = span_def["start_time"] * 1_000_000_000
        end_ns = span_def["end_time"] * 1_000_000_000

        proto_span = Span(
            trace_id=trace_id_bytes,
            span_id=span_id_bytes,
            parent_span_id=parent_bytes if span_def.get("parent_id") else b"",
            name=span_def["span_name"],
            kind=Span.SpanKind.SPAN_KIND_INTERNAL,
            start_time_unix_nano=start_ns,
            end_time_unix_nano=end_ns,
            attributes=attrs,
            status=Span.Status(code=Span.Status.StatusCode.STATUS_CODE_OK),
        )
        proto_spans.append(proto_span)

    request = ExportTraceServiceRequest(
        resource_spans=[
            ResourceSpans(
                resource=Resource(
                    attributes=[_make_kv("service.name", "vercelai-e2e-test")]
                ),
                scope_spans=[
                    ScopeSpans(
                        scope=InstrumentationScope(name="ai", version="4.0.0"),
                        spans=proto_spans,
                    )
                ],
            )
        ]
    )

    return request.SerializeToString()


class TestVercelAIIngestion:
    """E2E tests that verify Vercel AI SDK spans are processed by the adapter."""

    def test_generate_text_span_mapping(self, authed_api, cls_account):
        """Ingest a generateText-style span via OTLP, query back, verify ag.* mapping."""
        trace_id = uuid4().hex
        span_id = uuid4().hex[:16]
        now = int(time.time())

        prompt_data = {
            "system": "You are a helpful assistant.",
            "messages": [{"role": "user", "content": "Hello!"}],
        }

        spans = [
            {
                "span_id": span_id,
                "span_name": "ai.generateText",
                "start_time": now - 2,
                "end_time": now - 1,
                "attributes": {
                    "ai.operationId": "ai.generateText",
                    "ai.model.id": "gpt-4o-mini",
                    "ai.model.provider": "openai.chat",
                    "ai.prompt": dumps(prompt_data),
                    "ai.response.text": "Hello! How can I help?",
                    "ai.response.finishReason": "stop",
                    "ai.usage.promptTokens": 15,
                    "ai.usage.completionTokens": 8,
                    "ai.settings.temperature": 0.7,
                    "ai.settings.maxRetries": 2,
                    "ai.telemetry.functionId": "generate-story",
                    "operation.name": "ai.generateText generate-story",
                },
            }
        ]

        # Send via OTLP protobuf
        protobuf_data = _build_otlp_protobuf(trace_id, spans)

        api_url = cls_account["api_url"]
        credentials = cls_account["credentials"]

        otlp_response = requests.post(
            f"{api_url}/otlp/v1/traces",
            data=protobuf_data,
            headers={
                "Content-Type": "application/x-protobuf",
                "Authorization": credentials,
            },
            timeout=10,
        )
        assert otlp_response.status_code == 200, (
            f"OTLP ingest failed: {otlp_response.status_code} {otlp_response.text}"
        )

        # Query back and verify the adapter mapped ai.* -> ag.*
        response = wait_for_response(
            authed_api,
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {
                            "field": "trace_id",
                            "operator": "is",
                            "value": trace_id,
                        }
                    ]
                },
            },
            condition_fn=lambda r: r.json().get("count", 0) >= 1,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] >= 1

        span = body["spans"][0]
        attrs = span.get("attributes", {})
        ag = attrs.get("ag", {})

        # Verify data mapping
        assert ag.get("data", {}).get("inputs") == prompt_data
        assert ag.get("data", {}).get("outputs") == "Hello! How can I help?"

        # Verify meta mapping
        meta = ag.get("meta", {})
        assert meta.get("request", {}).get("model") == "gpt-4o-mini"
        assert meta.get("system") == "openai.chat"
        assert meta.get("request", {}).get("temperature") == 0.7
        assert meta.get("response", {}).get("finish_reasons") == ["stop"]

        # Verify metrics mapping
        # Pipeline renames unit.tokens.* -> tokens.incremental.* and cumulates
        # to tokens.cumulative.*. For a leaf span, incremental == cumulative.
        metrics = ag.get("metrics", {})
        tokens = metrics.get("tokens", {})
        inc = tokens.get("incremental", {})
        cum = tokens.get("cumulative", {})
        assert inc.get("prompt") == 15, f"Expected incremental.prompt=15, got {inc}"
        assert inc.get("completion") == 8, f"Expected incremental.completion=8, got {inc}"
        assert cum.get("prompt") == 15, f"Expected cumulative.prompt=15, got {cum}"
        assert cum.get("completion") == 8, f"Expected cumulative.completion=8, got {cum}"

        # Verify type mapping (pipeline renames ag.type.node -> ag.type.span)
        assert ag.get("type", {}).get("span") == "task", f"Expected type.span='task', got {ag.get('type')}"

    def test_stream_text_token_naming(self, authed_api, cls_account):
        """Verify streamText token naming (inputTokens/outputTokens) is mapped."""
        trace_id = uuid4().hex
        span_id = uuid4().hex[:16]
        now = int(time.time())

        spans = [
            {
                "span_id": span_id,
                "span_name": "ai.streamText",
                "start_time": now - 2,
                "end_time": now - 1,
                "attributes": {
                    "ai.operationId": "ai.streamText",
                    "ai.model.id": "claude-3-5-sonnet",
                    "ai.model.provider": "anthropic.messages",
                    "ai.prompt": dumps(
                        {"messages": [{"role": "user", "content": "Hi"}]}
                    ),
                    "ai.response.text": "Hey!",
                    "ai.usage.inputTokens": 10,
                    "ai.usage.outputTokens": 5,
                    "ai.usage.totalTokens": 15,
                },
            }
        ]

        protobuf_data = _build_otlp_protobuf(trace_id, spans)

        api_url = cls_account["api_url"]
        credentials = cls_account["credentials"]

        otlp_response = requests.post(
            f"{api_url}/otlp/v1/traces",
            data=protobuf_data,
            headers={
                "Content-Type": "application/x-protobuf",
                "Authorization": credentials,
            },
            timeout=10,
        )
        assert otlp_response.status_code == 200

        response = wait_for_response(
            authed_api,
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {
                            "field": "trace_id",
                            "operator": "is",
                            "value": trace_id,
                        }
                    ]
                },
            },
            condition_fn=lambda r: r.json().get("count", 0) >= 1,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] >= 1

        span = body["spans"][0]
        attrs = span.get("attributes", {})
        ag = attrs.get("ag", {})

        # Verify streamText token naming was mapped
        meta = ag.get("meta", {})
        assert meta.get("request", {}).get("model") == "claude-3-5-sonnet"

    def test_tool_call_span_mapping(self, authed_api, cls_account):
        """Verify tool call span inputs/outputs are mapped."""
        trace_id = uuid4().hex
        parent_span_id = uuid4().hex[:16]
        tool_span_id = uuid4().hex[:16]
        now = int(time.time())

        tool_args = {"city": "Berlin"}
        tool_result = {"temperature": 22, "unit": "celsius"}

        spans = [
            {
                "span_id": parent_span_id,
                "span_name": "ai.generateText",
                "start_time": now - 3,
                "end_time": now - 1,
                "attributes": {
                    "ai.operationId": "ai.generateText",
                    "ai.model.id": "gpt-4o",
                    "ai.response.text": "The weather is sunny.",
                    "ai.usage.promptTokens": 50,
                    "ai.usage.completionTokens": 20,
                },
            },
            {
                "span_id": tool_span_id,
                "parent_id": parent_span_id,
                "span_name": "ai.toolCall get_weather",
                "start_time": now - 2,
                "end_time": now - 1,
                "attributes": {
                    "ai.operationId": "ai.toolCall",
                    "ai.toolCall.name": "get_weather",
                    "ai.toolCall.id": "call_abc123",
                    "ai.toolCall.args": dumps(tool_args),
                    "ai.toolCall.result": dumps(tool_result),
                },
            },
        ]

        protobuf_data = _build_otlp_protobuf(trace_id, spans)

        api_url = cls_account["api_url"]
        credentials = cls_account["credentials"]

        otlp_response = requests.post(
            f"{api_url}/otlp/v1/traces",
            data=protobuf_data,
            headers={
                "Content-Type": "application/x-protobuf",
                "Authorization": credentials,
            },
            timeout=10,
        )
        assert otlp_response.status_code == 200

        response = wait_for_response(
            authed_api,
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {
                            "field": "trace_id",
                            "operator": "is",
                            "value": trace_id,
                        }
                    ]
                },
            },
            condition_fn=lambda r: r.json().get("count", 0) >= 2,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] >= 2
