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
    condition = Condition(field="unknown", operator=ComparisonOperator.IS, value="x")

    parse_condition(condition)

    assert condition.value == "x"


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
