from copy import deepcopy
from datetime import datetime
from uuid import UUID

import pytest

from oss.src.core.tracing.dtos import (
    FilteringException,
    Focus,
    Format,
    OTelEvent,
    OTelFlatSpan,
    OTelLink,
    OTelSpan,
    OTelSpanKind,
    OTelStatusCode,
)
from oss.src.core.tracing.utils.parsing import (
    parse_evt_name_to_str,
    parse_ref_id_to_uuid,
    parse_ref_slug_to_str,
    parse_ref_version_to_str,
    parse_span_id_from_uuid,
    parse_span_id_to_uuid,
    parse_span_kind_to_enum,
    parse_spans_from_request,
    parse_spans_into_response,
    parse_status_code_to_enum,
    parse_timestamp_to_datetime,
    parse_trace_id_from_uuid,
    parse_trace_id_to_uuid,
    parse_value_to_enum,
)


TRACE_HEX = "31d6cfe04b9011ec800142010a8000b0"
TRACE_UUID = "31d6cfe0-4b90-11ec-8001-42010a8000b0"
SPAN_HEX = "31d6cfe04b9011ec"
SPAN_UUID = "31d6cfe0-4b90-11ec-31d6-cfe04b9011ec"
CHILD_HEX = "41d6cfe04b9011ec"
CHILD_UUID = "41d6cfe0-4b90-11ec-41d6-cfe04b9011ec"


def _build_request_spans() -> list[OTelSpan]:
    root = OTelSpan(
        trace_id=TRACE_HEX,
        span_id=SPAN_HEX,
        span_name="root",
        start_time=1_700_000_000,
        end_time=1_700_000_001,
        attributes={
            "ag.references.application.id": TRACE_HEX,
            "ag.references.application.slug": "my_app",
            "ag.references.application.version": "v1",
            "ag.references.query.slug": "not valid slug",
            "ag.data.outputs.__default__": {"answer": 42},
        },
        events=[
            OTelEvent(
                name="exception",
                timestamp=1_700_000_000,
                attributes={
                    "message": "boom",
                    "type": "RuntimeError",
                    "stacktrace": "trace",
                },
            )
        ],
        links=[
            OTelLink(
                trace_id=TRACE_HEX,
                span_id=CHILD_HEX,
                attributes={"key": "parent"},
            )
        ],
        spans={
            "child": OTelSpan(
                trace_id=TRACE_HEX,
                span_id=CHILD_HEX,
                parent_id=SPAN_HEX,
                span_name="child",
                start_time=1_700_000_001,
                end_time=1_700_000_001,
                attributes={"ag.type.span": "task"},
            )
        },
    )

    return parse_spans_from_request({"root": root})


def test_parse_id_helpers_and_ref_string_helpers():
    assert parse_ref_id_to_uuid(TRACE_HEX) == TRACE_UUID
    assert parse_ref_id_to_uuid(f"0x{TRACE_HEX}") == TRACE_UUID
    assert parse_trace_id_to_uuid(TRACE_HEX) == TRACE_UUID
    assert parse_trace_id_to_uuid(f"0x{TRACE_HEX}") == TRACE_UUID
    assert parse_span_id_to_uuid(SPAN_HEX) == SPAN_UUID
    assert parse_span_id_to_uuid(f"0x{SPAN_HEX}") == SPAN_UUID

    assert parse_ref_slug_to_str("slug") == "slug"
    assert parse_ref_version_to_str("v1") == "v1"
    assert parse_evt_name_to_str(123) == "123"


@pytest.mark.parametrize(
    "fn,value",
    [
        (parse_ref_id_to_uuid, "not-a-uuid"),
        (parse_trace_id_to_uuid, "not-a-uuid"),
        (parse_span_id_to_uuid, "not-a-uuid"),
    ],
)
def test_parse_id_helpers_raise_on_invalid_values(fn, value):
    with pytest.raises(TypeError):
        fn(value)


def test_parse_uuid_to_wire_ids():
    trace_uuid = UUID(TRACE_UUID)
    span_uuid = UUID(SPAN_UUID)

    assert parse_trace_id_from_uuid(trace_uuid) == TRACE_HEX
    assert parse_trace_id_from_uuid(TRACE_UUID) == TRACE_HEX
    assert parse_span_id_from_uuid(span_uuid) == SPAN_HEX
    assert parse_span_id_from_uuid(SPAN_UUID) == SPAN_HEX


def test_parse_enum_and_value_helpers():
    assert parse_span_kind_to_enum("SPAN_KIND_CLIENT") == OTelSpanKind.SPAN_KIND_CLIENT
    assert parse_status_code_to_enum("STATUS_CODE_OK") == OTelStatusCode.STATUS_CODE_OK
    assert (
        parse_value_to_enum("SPAN_KIND_SERVER", OTelSpanKind)
        == OTelSpanKind.SPAN_KIND_SERVER
    )

    with pytest.raises(FilteringException):
        parse_span_kind_to_enum("not-supported")

    with pytest.raises(FilteringException):
        parse_status_code_to_enum("not-supported")

    with pytest.raises(FilteringException):
        parse_value_to_enum("not-supported", OTelStatusCode)


def test_parse_timestamp_to_datetime_handles_supported_inputs():
    dt = datetime(2024, 1, 1, 0, 0, 0)
    assert parse_timestamp_to_datetime(dt) is dt

    assert parse_timestamp_to_datetime("2024-01-01T00:00:00").year == 2024
    assert parse_timestamp_to_datetime(1_700_000_000) is not None
    assert parse_timestamp_to_datetime(1_700_000_000_000) is not None
    assert parse_timestamp_to_datetime(1_700_000_000_000_000) is not None
    assert parse_timestamp_to_datetime(1_700_000_000_000_000_000) is not None
    assert parse_timestamp_to_datetime(None) is None

    with pytest.raises(FilteringException):
        parse_timestamp_to_datetime(123456)


def test_parse_spans_from_request_flattens_tree_and_enriches_metrics_and_hashes():
    parsed = _build_request_spans()

    assert len(parsed) == 2

    root = next(span for span in parsed if span.span_name == "root")
    child = next(span for span in parsed if span.span_name == "child")

    assert root.trace_id == TRACE_UUID
    assert root.span_id == SPAN_UUID
    assert child.parent_id == SPAN_UUID

    metrics = root.attributes["ag"]["metrics"]
    assert metrics["duration"]["cumulative"] == 1000.0
    assert metrics["errors"]["incremental"] == 1

    assert root.exception == {
        "message": "boom",
        "type": "RuntimeError",
        "stacktrace": "trace",
    }

    assert root.references is not None
    assert root.references[0].attributes["key"] == "application"
    assert root.hashes is not None
    assert root.hashes[0].attributes["key"] == "indirect"


def test_parse_spans_from_request_returns_empty_list_on_unexpected_errors():
    parsed = parse_spans_from_request({"bad": [object()]})

    assert parsed == []


def test_parse_spans_into_response_returns_trace_map_for_trace_focus():
    parsed = _build_request_spans()

    response = parse_spans_into_response(
        deepcopy(parsed),
        focus=Focus.TRACE,
        format=Format.AGENTA,
    )

    assert TRACE_HEX in response
    root = response[TRACE_HEX]["spans"]["root"]

    assert root.span_id == SPAN_HEX
    assert root.attributes["ag"]["data"]["outputs"] == {"answer": 42}
    assert root.spans is not None
    assert "child" in root.spans


def test_parse_spans_into_response_returns_span_list_for_span_focus():
    parsed = _build_request_spans()

    response = parse_spans_into_response(
        deepcopy(parsed),
        focus=Focus.SPAN,
        format=Format.AGENTA,
    )

    assert isinstance(response, list)
    assert len(response) == 2
    assert response[0].trace_id == TRACE_HEX
    assert len(response[0].span_id) == 16


def test_parse_spans_into_response_trace_mode_returns_empty_dict_on_error():
    broken = OTelFlatSpan(
        trace_id=TRACE_UUID,
        span_id=SPAN_UUID,
        span_name="broken",
        attributes={"ag": {}},
    )

    response = parse_spans_into_response(
        [broken],
        focus=Focus.TRACE,
        format=Format.AGENTA,
    )

    assert response == {}
