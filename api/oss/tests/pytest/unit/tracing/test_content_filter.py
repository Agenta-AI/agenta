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
