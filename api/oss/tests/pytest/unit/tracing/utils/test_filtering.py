from re import escape

import pytest

from oss.src.core.tracing.dtos import (
    ComparisonOperator,
    Condition,
    DictOperator,
    ExistenceOperator,
    Fields,
    Filtering,
    FilteringException,
    ListOperator,
    LogicalOperator,
    NumericOperator,
    StringOperator,
    TracingQuery,
)
from oss.src.core.tracing.utils.filtering import (
    parse_condition,
    parse_filtering,
    validate_filtering,
    parse_ingest,
    parse_query,
)


TRACE_HEX = "31d6cfe04b9011ec800142010a8000b0"
TRACE_UUID = "31d6cfe0-4b90-11ec-8001-42010a8000b0"
SPAN_HEX = "31d6cfe04b9011ec"
SPAN_UUID = "31d6cfe0-4b90-11ec-31d6-cfe04b9011ec"


def test_parse_condition_normalizes_trace_and_span_ids():
    trace_condition = Condition(
        field=Fields.TRACE_ID,
        operator=ListOperator.IN,
        value=[TRACE_HEX],
    )
    span_condition = Condition(
        field=Fields.SPAN_ID,
        operator=ComparisonOperator.IS,
        value=SPAN_HEX,
    )

    parse_condition(trace_condition)
    parse_condition(span_condition)

    assert trace_condition.value == [TRACE_UUID]
    assert span_condition.value == SPAN_UUID


def test_parse_condition_supports_parent_id_none_and_list_values():
    condition = Condition(
        field=Fields.PARENT_ID,
        operator=ListOperator.IN,
        value=[SPAN_HEX],
    )
    null_condition = Condition(
        field=Fields.PARENT_ID,
        operator=ComparisonOperator.IS,
        value=None,
    )

    parse_condition(condition)
    parse_condition(null_condition)

    assert condition.value == [SPAN_UUID]
    assert null_condition.value is None


def test_parse_condition_for_links_references_and_events_list_values():
    links = Condition(
        field=Fields.LINKS,
        operator=ListOperator.IN,
        value=[{"trace_id": TRACE_HEX, "span_id": SPAN_HEX}],
    )
    references = Condition(
        field=Fields.REFERENCES,
        operator=ListOperator.IN,
        value=[{"id": TRACE_HEX, "slug": "slug", "version": "v1"}],
    )
    events = Condition(
        field=Fields.EVENTS,
        operator=ListOperator.IN,
        value=[{"name": 123}],
    )

    parse_condition(links)
    parse_condition(references)
    parse_condition(events)

    assert links.value == [
        {
            "trace_id": TRACE_UUID,
            "span_id": SPAN_UUID,
            "attributes": None,
        }
    ]
    assert references.value == [{"id": TRACE_UUID}, {"slug": "slug"}, {"version": "v1"}]
    assert events.value == [{"name": "123"}]


def test_parse_condition_for_hashes_supports_string_and_partial_hash_values():
    hashes = Condition(
        field=Fields.HASHES,
        operator=ListOperator.IN,
        value=["hash-1", {"id": "hash-2", "attributes": {"key": "indirect"}}],
    )
    hash_key = Condition(
        field=Fields.HASHES,
        key="id",
        operator=DictOperator.HAS,
        value="hash-3",
    )

    parse_condition(hashes)
    parse_condition(hash_key)

    assert hashes.value == [
        {"id": "hash-1"},
        {"id": "hash-2", "attributes": {"key": "indirect"}},
    ]
    assert hash_key.value == "hash-3"


@pytest.mark.parametrize(
    "condition,expected_message",
    [
        (
            Condition(
                field=Fields.HASHES,
                key="id",
                operator=ListOperator.IN,
                value=["hash-1"],
            ),
            "'hashes' key is only supported for dict operators.",
        ),
        (
            Condition(
                field=Fields.HASHES,
                key="id",
                operator=ExistenceOperator.EXISTS,
                value=None,
            ),
            "'hashes' key is only supported for dict operators.",
        ),
    ],
)
def test_parse_condition_for_hashes_rejects_invalid_key_operator_combinations(
    condition, expected_message
):
    with pytest.raises(FilteringException, match=escape(expected_message)):
        parse_condition(condition)


def test_parse_condition_for_enum_timestamp_uuid_and_string_fields():
    trace_type = Condition(
        field=Fields.TRACE_TYPE,
        operator=ComparisonOperator.IS,
        value="invocation",
    )
    span_name = Condition(
        field=Fields.SPAN_NAME,
        operator=StringOperator.CONTAINS,
        value=123,
    )
    start_time = Condition(
        field=Fields.START_TIME,
        operator=NumericOperator.GT,
        value=1_700_000_000,
    )
    created_by = Condition(
        field=Fields.CREATED_BY_ID,
        operator=ComparisonOperator.IS,
        value=TRACE_HEX,
    )

    parse_condition(trace_type)
    parse_condition(span_name)
    parse_condition(start_time)
    parse_condition(created_by)

    assert trace_type.value.value == "invocation"
    assert span_name.value == "123"
    assert start_time.value is not None
    assert created_by.value == TRACE_UUID


def test_parse_condition_ignores_unknown_field_instead_of_raising():
    # Tracing queries and analytics keep ignoring an unknown field.
    condition = Condition(field="unknown", operator=ComparisonOperator.IS, value="x")

    parse_condition(condition)

    assert condition.value == "x"


def test_validate_filtering_raises_for_unknown_field_also_when_nested():
    # A saved query must not widen its filter: a live evaluation would score every trace.
    filtering = Filtering(
        conditions=[
            Condition(
                field="trace_type", operator=ComparisonOperator.IS, value="invocation"
            ),
            Filtering(
                operator="or",
                conditions=[
                    Condition(
                        field="unknown", operator=ComparisonOperator.IS, value="x"
                    )
                ],
            ),
        ]
    )

    with pytest.raises(
        FilteringException, match=escape("Unsupported condition field 'unknown'.")
    ):
        validate_filtering(filtering)


def test_validate_filtering_accepts_picker_fields_and_leaves_them_unchanged():
    filtering = Filtering(
        conditions=[
            Condition(
                field="attributes.ag.session.id",
                operator=ComparisonOperator.IS,
                value="s-1",
            ),
            Condition(
                field="is_annotation",
                operator="in",
                value=[{"evaluator": "exact-match"}],
            ),
            Condition(field="has_annotation", operator="not_in", value=[]),
        ]
    )
    before = filtering.model_dump()

    validate_filtering(filtering)

    assert filtering.model_dump() == before


# The trace filter picker stores these field names in saved queries. Each case is the
# picker row and the condition the traces page sends for it (`buildTraceQueryParams`).
@pytest.mark.parametrize(
    "row,expected",
    [
        (
            {
                "field": "attributes.ag.session.id",
                "operator": "is",
                "value": "s-1",
            },
            {"key": "ag.session.id", "operator": ComparisonOperator.IS, "value": "s-1"},
        ),
        (
            {
                "field": "attributes.ag.metrics.costs.cumulative.total",
                "operator": "gt",
                "value": 0.5,
            },
            {
                "key": "ag.metrics.costs.cumulative.total",
                "operator": NumericOperator.GT,
                "value": 0.5,
            },
        ),
        (
            {
                "field": "input_keys",
                "key": "attributes.ag.data.inputs.country",
                "operator": "is",
                "value": "Peru",
            },
            {
                "key": "ag.data.inputs.country",
                "operator": ComparisonOperator.IS,
                "value": "Peru",
            },
        ),
        (
            {
                "field": "output_keys",
                "key": "attributes.ag.data.outputs.answer",
                "operator": "contains",
                "value": "Lima",
            },
            {
                "key": "ag.data.outputs.answer",
                "operator": StringOperator.CONTAINS,
                "value": "Lima",
            },
        ),
        (
            {
                "field": "custom",
                "key": "attributes.ag.tags.env",
                "operator": "is_not",
                "value": "prod",
            },
            {
                "key": "ag.tags.env",
                "operator": ComparisonOperator.IS_NOT,
                "value": "prod",
            },
        ),
        (
            {"field": "custom", "key": "ag.tags.env", "operator": "is", "value": "x"},
            {"key": "ag.tags.env", "operator": ComparisonOperator.IS, "value": "x"},
        ),
    ],
)
def test_parse_condition_maps_picker_attribute_fields(row, expected):
    condition = Condition(**row)

    assert parse_condition(condition) is condition
    assert condition.field == Fields.ATTRIBUTES
    assert condition.key == expected["key"]
    assert condition.operator == expected["operator"]
    assert condition.value == expected["value"]


@pytest.mark.parametrize("field", ["custom", "input_keys", "output_keys"])
def test_parse_condition_raises_for_picker_key_field_without_key(field):
    with pytest.raises(FilteringException, match=escape(f"'{field}' key is required")):
        parse_condition(Condition(field=field, operator="is", value="x"))


def test_parse_condition_maps_is_annotation_to_evaluator_and_feedback_conditions():
    condition = Condition(
        field="is_annotation",
        operator="in",
        value=[
            {
                "evaluator": "exact-match",
                "feedback": {
                    "field": "score",
                    "operator": "gte",
                    "value": 0.5,
                    "valueType": "number",
                },
            }
        ],
    )

    parsed = parse_condition(condition)

    assert isinstance(parsed, Filtering)
    assert parsed.operator == LogicalOperator.AND
    references, feedback = parsed.conditions
    assert references.field == Fields.REFERENCES
    assert references.operator == ListOperator.IN
    assert references.value == [{"slug": "exact-match"}]
    assert feedback.field == Fields.ATTRIBUTES
    assert feedback.key == "ag.data.outputs.score"
    assert feedback.operator == NumericOperator.GTE
    assert feedback.value == 0.5


def test_parse_filtering_replaces_is_annotation_with_its_conditions():
    filtering = Filtering(
        operator=LogicalOperator.OR,
        conditions=[
            Condition(field="trace_type", operator="is", value="invocation"),
            Condition(
                field="is_annotation",
                operator="not_in",
                value={"evaluator": "exact-match"},
            ),
        ],
    )

    parse_filtering(filtering)

    nested = filtering.conditions[1]
    assert isinstance(nested, Filtering)
    assert nested.conditions[0].field == Fields.REFERENCES
    assert nested.conditions[0].operator == ListOperator.NOT_IN


def test_parse_condition_normalizes_has_annotation_value():
    condition = Condition(
        field="has_annotation",
        operator="in",
        value=[
            {
                "evaluator": "exact-match",
                "feedback": {
                    "field": "success",
                    "operator": "is",
                    "value": True,
                    "valueType": "boolean",
                },
            }
        ],
    )

    assert parse_condition(condition) is condition
    assert condition.field == Fields.HAS_ANNOTATION
    normalized = [
        {"evaluator": "exact-match"},
        {"feedback": {"field": "success", "operator": "is", "value": True}},
    ]
    assert condition.value == normalized

    # A reused query is parsed again on its next page.
    assert parse_condition(condition) is condition
    assert condition.value == normalized


def test_parse_condition_reads_a_feedback_field_list_as_one_filter_per_field():
    # The "any evaluator" picker saves the field as a list, also for one field.
    condition = Condition(
        field="has_annotation",
        operator="not_in",
        value=[{"feedback": {"field": ["score"], "operator": "gte", "value": 1}}],
    )

    parse_condition(condition)

    assert condition.value == [
        {"feedback": {"field": "score", "operator": "gte", "value": 1}}
    ]

    several = Condition(
        field="is_annotation",
        operator="in",
        value=[{"feedback": {"field": ["quality", "safe"], "value": True}}],
    )
    keys = [c.key for c in parse_condition(several).conditions]
    assert keys == ["ag.data.outputs.quality", "ag.data.outputs.safe"]


def test_parse_filtering_joins_has_annotation_rows_into_one_annotation():
    # The traces page reads all has_annotation rows in one annotation query.
    filtering = Filtering(
        conditions=[
            Condition(
                field="has_annotation",
                operator="in",
                value=[{"feedback": {"field": "quality", "value": True}}],
            ),
            Condition(field="trace_type", operator="is", value="invocation"),
            Condition(
                field="has_annotation",
                operator="in",
                value=[{"feedback": {"field": "safe", "value": True}}],
            ),
        ]
    )

    parse_filtering(filtering)

    [has_annotation, trace_type] = filtering.conditions
    assert trace_type.field == Fields.TRACE_TYPE
    assert has_annotation.value == [
        {"feedback": {"field": "quality", "operator": "is", "value": True}},
        {"feedback": {"field": "safe", "operator": "is", "value": True}},
    ]


def test_parse_condition_accepts_has_annotation_without_evaluator_or_feedback():
    # "Has any annotation", as on the traces page.
    condition = Condition(field="has_annotation", operator="not_in", value=[])

    parse_condition(condition)

    assert condition.value == []


@pytest.mark.parametrize(
    "condition,expected_message",
    [
        (
            Condition(field="has_annotation", operator="is", value=[]),
            "'has_annotation' only supports list operators.",
        ),
        (
            Condition(field="has_annotation", operator="in", value="exact-match"),
            "'has_annotation' value must be objects",
        ),
        (
            Condition(
                field="has_annotation",
                operator="in",
                value=[{"feedback": {"operator": "is", "value": 1}}],
            ),
            "'has_annotation' feedback must name one or more output fields.",
        ),
        (
            Condition(
                field="has_annotation",
                operator="in",
                value=[{"feedback": {"field": "score", "operator": "nope"}}],
            ),
            "'has_annotation' feedback operator or value is not supported.",
        ),
        (
            Condition(field="is_annotation", operator="in", value=[]),
            "'is_annotation' needs an evaluator or a feedback.",
        ),
    ],
)
def test_parse_condition_raises_for_invalid_annotation_rows(
    condition, expected_message
):
    with pytest.raises(FilteringException, match=escape(expected_message)):
        parse_condition(condition)


def test_parse_filtering_recurses_nested_filters_and_parse_query_delegates():
    filtering = Filtering(
        operator=LogicalOperator.AND,
        conditions=[
            Condition(
                field=Fields.STATUS_MESSAGE,
                operator=StringOperator.CONTAINS,
                value="ok",
            ),
            Filtering(
                operator=LogicalOperator.OR,
                conditions=[
                    Condition(
                        field=Fields.TRACE_ID,
                        operator=ComparisonOperator.IS,
                        value=TRACE_HEX,
                    )
                ],
            ),
        ],
    )

    parse_filtering(filtering)

    assert filtering.conditions[1].conditions[0].value == TRACE_UUID

    query = TracingQuery(filtering=filtering)
    parse_query(query)


def test_parse_ingest_is_currently_a_noop():
    parse_ingest([])


@pytest.mark.parametrize(
    "condition,expected_message",
    [
        (
            Condition(
                field=Fields.TRACE_ID, operator=StringOperator.CONTAINS, value="x"
            ),
            "'trace_id' only supports comparison and list operators.",
        ),
        (
            Condition(
                field=Fields.SPAN_ID, operator=StringOperator.CONTAINS, value="x"
            ),
            "'span_id' only supports comparison and list operators.",
        ),
        (
            Condition(
                field=Fields.ATTRIBUTES,
                operator=ComparisonOperator.IS,
                key=None,
                value=1,
            ),
            "'attributes' key is required and thus never null.",
        ),
        (
            Condition(field=Fields.LINKS, operator=ListOperator.IN, value="bad"),
            "'links' value must be one or more (possibly partial) links.",
        ),
        (
            Condition(field=Fields.REFERENCES, operator=ListOperator.IN, value="bad"),
            "'references' value must be one or more (possibly partial) references.",
        ),
        (
            Condition(field=Fields.EVENTS, operator=ListOperator.IN, value="bad"),
            "'events' value must be one or more (possibly partial) events.",
        ),
        (
            Condition(field=Fields.HASHES, operator=ListOperator.IN, value="bad"),
            "'hashes' value must be one or more hash ids or partial hashes.",
        ),
        (
            Condition(field=Fields.CONTENT, operator=ComparisonOperator.IS, value="x"),
            "'content' only supports full-text search operator: 'contains'.",
        ),
        (
            Condition(
                field=Fields.CONTENT, operator=StringOperator.CONTAINS, value=None
            ),
            "'content' value is required and thus never null for full-text search.",
        ),
        (
            Condition(field=Fields.CONTENT, operator=StringOperator.CONTAINS, value=1),
            "'content' value must be a string for full-text search.",
        ),
        (
            Condition(
                field=Fields.STATUS_MESSAGE,
                operator=ExistenceOperator.EXISTS,
                value="not-allowed",
            ),
            "'status_message' value is not supported for existence operators.",
        ),
    ],
)
def test_parse_condition_raises_for_invalid_conditions(condition, expected_message):
    with pytest.raises(FilteringException, match=escape(expected_message)):
        parse_condition(condition)


def test_parse_filtering_raises_for_unknown_nested_condition_type():
    filtering = Filtering(conditions=[{"field": "trace_id"}])

    filtering.conditions = [object()]  # type: ignore

    with pytest.raises(FilteringException, match="Unsupported condition type"):
        parse_filtering(filtering)


def test_parse_filtering_of_picker_fields_is_idempotent():
    filtering = Filtering(
        conditions=[
            Condition(field="attributes.ag.session.id", operator="is", value="s-1"),
            Condition(
                field="custom", key="attributes.ag.tags.env", operator="is", value="x"
            ),
            Condition(
                field="is_annotation",
                operator="in",
                value=[{"evaluator": "e", "feedback": {"field": "score", "value": 1}}],
            ),
            Condition(
                field="has_annotation",
                operator="not_in",
                value=[{"evaluator": "e", "feedback": {"field": "score", "value": 1}}],
            ),
        ]
    )

    parse_filtering(filtering)
    once = filtering.model_dump(mode="json")
    parse_filtering(filtering)

    assert filtering.model_dump(mode="json") == once
