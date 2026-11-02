import pytest
from sqlalchemy.dialects import postgresql

from oss.src.dbs.postgres.folders.dao import _path_under


@pytest.mark.parametrize(
    "prefix",
    [
        "support.prod",
        "it's.here",
        "root.:name",
    ],
)
def test_prefix_is_bound_and_cast_to_ltree(prefix):
    compiled = _path_under(prefix).compile(dialect=postgresql.dialect())
    sql = str(compiled)

    assert prefix not in sql
    assert "CAST(" in sql and "AS LTREE)" in sql
    assert "<@" in sql
    assert list(compiled.params.values()) == [prefix]
