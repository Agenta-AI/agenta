import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from oss.src.core.tracing.dtos import Condition, Filtering, FilteringException
from oss.src.core.tracing.utils.filtering import parse_filtering
from oss.src.dbs.postgres.tracing.dbes import SpanDBE
from oss.src.dbs.postgres.tracing.utils import filter as build_filter


def _sql(*conditions: Condition) -> str:
    """The WHERE clause of a span query, so the subquery correlates to `spans`."""
    filtering = Filtering(conditions=list(conditions))
    parse_filtering(filtering)
    clauses = build_filter(filtering.conditions)
    assert len(clauses) == 1
    stmt = select(SpanDBE.trace_id).where(clauses[0])
    sql = str(stmt.compile(dialect=postgresql.dialect()))
    return sql.split("WHERE ", 1)[1]


def test_has_annotation_in_matches_the_linked_span_of_an_annotation_trace():
    sql = _sql(
        Condition(
            field="has_annotation",
            operator="in",
            value=[
                {
                    "evaluator": "exact-match",
                    "feedback": {"field": "score", "operator": "gte", "value": 1},
                }
            ],
        )
    )

    assert sql.startswith("EXISTS (SELECT 1 \nFROM spans AS annotation \nWHERE")
    assert "annotation.project_id = spans.project_id" in sql
    assert "annotation.trace_type = %(trace_type_1)s" in sql
    assert (
        "annotation.links @> jsonb_build_array(jsonb_build_object("
        "'trace_id', CAST(spans.trace_id AS TEXT), "
        "'span_id', CAST(spans.span_id AS TEXT)))"
    ) in sql
    assert 'annotation."references" @> CAST(' in sql
    assert "annotation.attributes" in sql


def test_has_annotation_not_in_excludes_every_span_of_an_annotated_trace():
    sql = _sql(Condition(field="has_annotation", operator="not_in", value=[]))

    assert sql.startswith("NOT (EXISTS (SELECT 1 \nFROM spans AS annotation \nWHERE")
    assert "jsonb_build_object('trace_id', CAST(spans.trace_id AS TEXT))" in sql
    assert "span_id" not in sql
    assert "references" not in sql


def test_picker_attribute_field_filters_on_the_attributes_column():
    sql = _sql(
        Condition(
            field="attributes.ag.session.id",
            operator="is",
            value="no-such-session",
        )
    )

    assert "spans.attributes" in sql


def test_filter_raises_for_unknown_field():
    with pytest.raises(FilteringException, match="Unsupported condition field"):
        build_filter([Condition(field="unknown", operator="is", value="x")])
