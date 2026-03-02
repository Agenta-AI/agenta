import os
from uuid import uuid4

import pytest
import requests
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from utils.constants import BASE_TIMEOUT
from utils.polling import wait_for_condition


def _read_e2e_env() -> tuple[str, str]:
    base_url = os.getenv("AGENTA_OTLP_E2E_API_URL") or os.getenv("AGENTA_API_URL")
    api_key = os.getenv("AGENTA_OTLP_E2E_API_KEY") or os.getenv("AGENTA_API_KEY")

    if not base_url or not api_key:
        pytest.skip(
            "Set AGENTA_OTLP_E2E_API_URL and AGENTA_OTLP_E2E_API_KEY (or AGENTA_API_URL and AGENTA_API_KEY) to run OTLP E2E tests."
        )

    return base_url.rstrip("/"), api_key


def _path(base_url: str, endpoint: str) -> str:
    if base_url.endswith("/api"):
        return f"{base_url}{endpoint}"
    return f"{base_url}/api{endpoint}"


def _otlp_post(base_url: str, api_key: str, payload: bytes) -> requests.Response:
    return requests.post(
        _path(base_url, "/otlp/v1/traces"),
        data=payload,
        timeout=BASE_TIMEOUT,
        headers={
            "Authorization": f"ApiKey {api_key}",
            "Content-Type": "application/x-protobuf",
        },
    )


def _trace_get(base_url: str, api_key: str, trace_id: str) -> requests.Response:
    return requests.get(
        _path(base_url, f"/tracing/traces/{trace_id}"),
        timeout=BASE_TIMEOUT,
        headers={"Authorization": f"ApiKey {api_key}"},
    )


def _build_span(
    scope_spans, *, trace_id_hex: str, span_id_hex: str, kind: int, attributes: dict
):
    span = scope_spans.spans.add()
    span.trace_id = bytes.fromhex(trace_id_hex)
    span.span_id = bytes.fromhex(span_id_hex)
    span.name = "otlp-best-effort-e2e"
    span.kind = kind
    span.start_time_unix_nano = 1_700_000_000_000_000_000
    span.end_time_unix_nano = 1_700_000_000_100_000_000

    for key, value in attributes.items():
        kv = span.attributes.add()
        kv.key = key
        kv.value.string_value = value


class TestOTLPBestEffortE2E:
    def test_mixed_batch_ingests_valid_span(self):
        base_url, api_key = _read_e2e_env()

        req = ExportTraceServiceRequest()
        scope_spans = req.resource_spans.add().scope_spans.add()

        valid_trace_id = uuid4().hex

        _build_span(
            scope_spans,
            trace_id_hex=valid_trace_id,
            span_id_hex=uuid4().hex[16:],
            kind=2,
            attributes={
                "ag.type.trace": "invocation",
                "ag.type.span": "task",
            },
        )

        # Malformed span kind to trigger per-span drop.
        _build_span(
            scope_spans,
            trace_id_hex=uuid4().hex,
            span_id_hex=uuid4().hex[16:],
            kind=999,
            attributes={
                "ag.type.trace": "invocation",
                "ag.type.span": "task",
            },
        )

        ingest_response = _otlp_post(base_url, api_key, req.SerializeToString())
        assert ingest_response.status_code == 200

        response = wait_for_condition(
            lambda: (
                (r := _trace_get(base_url, api_key, valid_trace_id)).status_code == 200
                and r.json().get("count", 0) == 1,
                r,
            ),
            timeout_message="Expected valid span from mixed OTLP batch to be ingested",
        )

        assert response.status_code == 200
        assert response.json().get("count") == 1

    def test_json_strings_are_parsed_for_dict_fields_only(self):
        base_url, api_key = _read_e2e_env()

        trace_id = uuid4().hex
        req = ExportTraceServiceRequest()
        scope_spans = req.resource_spans.add().scope_spans.add()

        _build_span(
            scope_spans,
            trace_id_hex=trace_id,
            span_id_hex=uuid4().hex[16:],
            kind=2,
            attributes={
                "ag.type.trace": "invocation",
                "ag.type.span": "task",
                "ag.data.inputs": '{"messages":[{"role":"user","content":"hello"}]}',
                "ag.data.parameters": '{"temperature":0.2}',
                "ag.data.internals": '{"debug":true}',
                "ag.data.outputs": '{"content":"leave-string"}',
            },
        )

        ingest_response = _otlp_post(base_url, api_key, req.SerializeToString())
        assert ingest_response.status_code == 200

        response = wait_for_condition(
            lambda: (
                (r := _trace_get(base_url, api_key, trace_id)).status_code == 200
                and r.json().get("count", 0) == 1,
                r,
            ),
            timeout_message="Expected OTLP JSON string span to be ingested",
        )

        trace_json = response.json()
        tree = trace_json["traces"][trace_id]
        span = next(iter(tree["spans"].values()))
        ag_data = span["attributes"]["ag"]["data"]

        assert isinstance(ag_data["inputs"], str)
        assert isinstance(ag_data["parameters"], dict)
        assert isinstance(ag_data["internals"], dict)
        assert isinstance(ag_data["outputs"], str)
