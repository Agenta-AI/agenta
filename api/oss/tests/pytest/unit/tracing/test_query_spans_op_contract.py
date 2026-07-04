from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from oss.src.apis.fastapi.tracing.models import SpansQueryRequest


def _ref_name(ref: str) -> str:
    return ref.removeprefix("#/$defs/")


def _single_ref_name(node: dict) -> str:
    refs = [item["$ref"] for item in node["anyOf"] if "$ref" in item]
    assert len(refs) == 1
    return _ref_name(refs[0])


def test_query_spans_op_schema_round_trips_through_endpoint_model():
    schema = PLATFORM_OPS["query_spans"].resolved_input_schema()
    endpoint_schema = SpansQueryRequest.model_json_schema()

    assert PLATFORM_OPS["query_spans"].path == "/api/spans/query"
    assert set(schema["properties"]) == set(SpansQueryRequest.model_fields)
    assert set(schema["properties"]) == set(endpoint_schema["properties"])

    defs = schema["$defs"]
    endpoint_defs = endpoint_schema["$defs"]
    for name in ("Filtering", "Condition", "Windowing", "Reference"):
        assert set(defs[name]["properties"]) == set(endpoint_defs[name]["properties"])

    assert _single_ref_name(schema["properties"]["filtering"]) == "Filtering"
    assert _single_ref_name(schema["properties"]["windowing"]) == "Windowing"
    assert _single_ref_name(schema["properties"]["query_ref"]) == "Reference"
    assert _single_ref_name(schema["properties"]["query_variant_ref"]) == "Reference"
    assert _single_ref_name(schema["properties"]["query_revision_ref"]) == "Reference"

    payload = {
        "filtering": {
            "operator": "and",
            "conditions": [
                {"field": "trace_id", "operator": "is", "value": "trace-123"}
            ],
        },
        "windowing": {
            "oldest": "2026-07-04T10:00:00Z",
            "newest": "2026-07-04T10:05:00Z",
            "next": "00000000-0000-0000-0000-000000000001",
            "limit": 25,
            "order": "descending",
            "interval": 60,
            "rate": 1.0,
        },
        "query_ref": {"slug": "recent-agent-runs"},
        "query_variant_ref": {"slug": "recent-agent-runs", "version": "latest"},
        "query_revision_ref": {"id": "00000000-0000-0000-0000-000000000002"},
    }

    assert set(payload) == set(schema["properties"])
    assert set(payload) <= set(SpansQueryRequest.model_fields)

    validated = SpansQueryRequest.model_validate(payload)

    assert validated.model_fields_set == set(payload)
    for key in payload:
        assert getattr(validated, key) is not None, f"{key} was silently dropped"
        assert key in validated.model_dump(exclude_unset=True)

    assert validated.filtering.conditions[0].field == "trace_id"
    assert validated.windowing.limit == 25
    assert validated.query_ref.slug == "recent-agent-runs"
