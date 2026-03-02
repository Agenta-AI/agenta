from uuid import uuid4

import requests
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from utils.constants import BASE_TIMEOUT
from utils.polling import wait_for_condition


def _otlp_post(api_url: str, credentials: str, payload: bytes) -> requests.Response:
    return requests.post(
        f"{api_url}/otlp/v1/traces",
        data=payload,
        timeout=BASE_TIMEOUT,
        headers={
            "Authorization": credentials,
            "Content-Type": "application/x-protobuf",
        },
    )


def _trace_get(api_url: str, credentials: str, trace_id: str) -> requests.Response:
    return requests.get(
        f"{api_url}/tracing/traces/{trace_id}",
        timeout=BASE_TIMEOUT,
        headers={"Authorization": credentials},
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
    def test_mixed_batch_ingests_valid_span(self, cls_account):
        api_url = cls_account["api_url"]
        credentials = cls_account["credentials"]

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

        ingest_response = _otlp_post(api_url, credentials, req.SerializeToString())
        assert ingest_response.status_code == 200

        response = wait_for_condition(
            lambda: (
                (r := _trace_get(api_url, credentials, valid_trace_id)).status_code == 200
                and r.json().get("count", 0) == 1,
                r,
            ),
            timeout_message="Expected valid span from mixed OTLP batch to be ingested",
        )

        assert response.status_code == 200
        assert response.json().get("count") == 1

    def test_json_strings_are_parsed_for_dict_fields_only(self, cls_account):
        api_url = cls_account["api_url"]
        credentials = cls_account["credentials"]

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

        ingest_response = _otlp_post(api_url, credentials, req.SerializeToString())
        assert ingest_response.status_code == 200

        response = wait_for_condition(
            lambda: (
                (r := _trace_get(api_url, credentials, trace_id)).status_code == 200
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
