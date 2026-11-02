import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.tracing.dtos import Condition, Fields
from oss.src.dbs.postgres.tracing.utils import filter as build_filter


def _compile(value):
    clauses = build_filter([Condition(field=Fields.CONTENT, value=value)])
    assert len(clauses) == 1
    return clauses[0].compile(dialect=postgresql.dialect())


@pytest.mark.parametrize(
    "value",
    [
        "hello world",
        "it's here",
        "o'clock -- notes",
        'say "hi" (or not); 50% :tag',
    ],
)
def test_content_filter_binds_search_term(value):
    compiled = _compile(value)
    sql = str(compiled)

    assert value not in sql
    assert "'" + value not in sql
    assert sql.count("websearch_to_tsquery") == 2
    assert list(compiled.params.values()) == [value, value]


def test_content_filter_searches_attributes_and_events():
    sql = str(_compile("hello"))

    assert "to_tsvector('simple', spans.attributes)" in sql
    assert "to_tsvector('simple', spans.events)" in sql


def test_two_content_conditions_bind_distinct_values():
    clauses = build_filter(
        [
            Condition(field=Fields.CONTENT, value="first's"),
            Condition(field=Fields.CONTENT, value="second :name"),
        ]
    )
    assert len(clauses) == 2

    values = []
    for clause in clauses:
        compiled = clause.compile(dialect=postgresql.dialect())
        assert "first's" not in str(compiled)
        assert "second :name" not in str(compiled)
        values.extend(compiled.params.values())

    assert values == ["first's", "first's", "second :name", "second :name"]
