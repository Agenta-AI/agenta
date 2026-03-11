from oss.src.core.shared.dtos import Link, Windowing
from oss.src.core.tracing.dtos import (
    ComparisonOperator,
    Filtering,
    Focus,
    Format,
    ListOperator,
    LogicalOperator,
    OTelLink,
    OTelSpan,
    OTelSpansTree,
)
from oss.src.core.tracing.utils.traces import (
    build_otel_links,
    build_simple_trace_attributes,
    build_simple_trace_filtering,
    build_simple_trace_query,
    extract_root_span,
    first_link,
    parse_named_links,
    parse_reference_map,
    parse_simple_trace,
)


TRACE_UUID = "31d6cfe0-4b90-11ec-8001-42010a8000b0"
SPAN_UUID = "31d6cfe0-4b90-11ec-31d6-cfe04b9011ec"
CHILD_UUID = "41d6cfe0-4b90-11ec-41d6-cfe04b9011ec"


def test_build_simple_trace_attributes_builds_ag_payload():
    attrs = build_simple_trace_attributes(
        trace_kind="invocation",
        flags={"is_web": True},
        tags={"env": "dev"},
        meta={"origin": "api"},
        data={"inputs": {"q": "hello"}},
        references={"application": {"id": TRACE_UUID}},
    )

    ag = attrs["ag"]
    assert ag["type"] == {"trace": "invocation", "span": "task"}
    assert ag["flags"]["is_web"] is True
    assert ag["tags"]["env"] == "dev"


def test_build_otel_links_supports_dict_and_list_inputs_and_filters_missing_ids():
    dict_links = {
        "parent": Link(trace_id=TRACE_UUID, span_id=SPAN_UUID),
        "skip": Link(trace_id=None, span_id=SPAN_UUID),
    }
    list_links = [
        Link(trace_id=TRACE_UUID, span_id=SPAN_UUID),
        Link(trace_id=TRACE_UUID, span_id=None),
    ]

    out_dict = build_otel_links(dict_links)
    out_list = build_otel_links(list_links)

    assert len(out_dict) == 1
    assert out_dict[0].attributes["key"] == "parent"

    assert len(out_list) == 1
    assert out_list[0].attributes["key"] == "key"

    assert build_otel_links(None) is None


def test_first_link_returns_first_valid_link():
    links = [
        OTelLink(trace_id=TRACE_UUID, span_id=SPAN_UUID, attributes={"key": "k1"}),
        OTelLink(trace_id=TRACE_UUID, span_id=CHILD_UUID, attributes={"key": "k2"}),
    ]

    first = first_link(links)
    assert first is not None
    assert first.trace_id == TRACE_UUID
    assert first.span_id == SPAN_UUID

    assert first_link([]) is None
    assert first_link([OTelLink(trace_id=None, span_id=SPAN_UUID)]) is None


def test_extract_root_span_returns_first_named_span_only():
    root = OTelSpan(
        trace_id=TRACE_UUID,
        span_id=SPAN_UUID,
        span_name="root",
        attributes={"ag": {}},
    )

    assert extract_root_span(None) is None
    assert extract_root_span(OTelSpansTree(spans=None)) is None

    tree = OTelSpansTree(spans={"root": root})
    assert extract_root_span(tree).span_id == SPAN_UUID

    tree_with_list = OTelSpansTree(spans={"root": [root]})
    assert extract_root_span(tree_with_list) is None


def test_parse_reference_and_link_maps():
    refs = parse_reference_map(
        {
            "application": {"id": TRACE_UUID, "slug": "app", "version": "v1"},
            "skip": "not-a-dict",
        }
    )

    links = parse_named_links(
        [
            OTelLink(
                trace_id=TRACE_UUID, span_id=SPAN_UUID, attributes={"key": "parent"}
            ),
            OTelLink(
                trace_id=TRACE_UUID, span_id=CHILD_UUID, attributes={"missing": "key"}
            ),
        ]
    )

    assert str(refs["application"].id) == TRACE_UUID
    assert "skip" not in refs
    assert links["parent"].span_id == SPAN_UUID


def test_parse_simple_trace_extracts_root_data_and_returns_none_without_data():
    root = OTelSpan(
        trace_id=TRACE_UUID,
        span_id=SPAN_UUID,
        span_name="root",
        links=[
            OTelLink(
                trace_id=TRACE_UUID, span_id=CHILD_UUID, attributes={"key": "parent"}
            )
        ],
        attributes={
            "ag": {
                "type": {"trace": "invocation", "span": "task"},
                "flags": {"is_web": True},
                "tags": {"env": "dev"},
                "meta": {"origin": "api"},
                "data": {"inputs": {"q": "hello"}},
                "references": {"application": {"id": TRACE_UUID, "slug": "app"}},
            }
        },
    )

    parsed = parse_simple_trace(OTelSpansTree(spans={"root": root}))

    assert parsed is not None
    assert parsed.span.span_id == SPAN_UUID
    assert parsed.flags == {"is_web": True}
    assert parsed.tags == {"env": "dev"}
    assert parsed.meta == {"origin": "api"}
    assert parsed.data == {"inputs": {"q": "hello"}}
    assert parsed.references["application"].slug == "app"
    assert parsed.links["parent"].span_id == CHILD_UUID

    no_data_root = OTelSpan(
        trace_id=TRACE_UUID,
        span_id=SPAN_UUID,
        span_name="root",
        attributes={"ag": {"type": {"trace": "invocation", "span": "task"}}},
    )
    assert parse_simple_trace(OTelSpansTree(spans={"root": no_data_root})) is None


def test_build_simple_trace_filtering_contains_expected_conditions_and_query_wrapper():
    filtering = build_simple_trace_filtering(
        trace_kind="invocation",
        flags={"is_web": True},
        tags={"env": "dev"},
        meta={"origin": "api"},
        references={"application": {"id": TRACE_UUID, "slug": "app"}},
        links=[
            Link(trace_id=TRACE_UUID, span_id=SPAN_UUID),
            Link(trace_id=TRACE_UUID, span_id=CHILD_UUID),
        ],
        trace_links={"scope": Link(trace_id=TRACE_UUID, span_id=SPAN_UUID)},
    )

    assert filtering.operator == LogicalOperator.AND
    first = filtering.conditions[0]
    assert first.field == "attributes"
    assert first.key == "ag.type.trace"
    assert first.value == "invocation"
    assert first.operator == ComparisonOperator.IS

    trace_scope = next(
        c for c in filtering.conditions if getattr(c, "field", None) == "trace_id"
    )
    assert trace_scope.operator == ListOperator.IN
    assert trace_scope.value == [TRACE_UUID]

    or_links = next(
        c
        for c in filtering.conditions
        if isinstance(c, Filtering) and c.operator == LogicalOperator.OR
    )
    assert len(or_links.conditions) == 2

    windowing = Windowing(limit=25)
    query = build_simple_trace_query(
        trace_kind="invocation",
        flags={"is_web": True},
        windowing=windowing,
    )

    assert query.formatting.focus == Focus.TRACE
    assert query.formatting.format == Format.AGENTA
    assert query.windowing == windowing
