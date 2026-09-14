"""`measurement_values` carries two unbounded metric columns, so both must be 64-bit.

`cost_musd` is money in millionths of a US dollar, so a 32-bit column overflows at
2_147_483_647 musd — about 2147 US dollars, which a single component cost (a long sandbox
run, a large batch of tokens) can exceed. `value` is whatever count the envelope carries
(msec, tokens); `MeasurementComponentV1` bounds neither. Both were `Integer` in the model
and its migration, so the insert failed instead of persisting the measurement.

That failure is not self-limiting. The measurement worker treats a readable envelope as
retryable, so a row Postgres rejects for overflow is redelivered forever, and
`reclaim_batch` always reads the OLDEST fifty pending entries: enough stuck entries starve
the healthy ones behind them.

The migration is checked as source, not by running alembic: the model and the DDL are two
independent declarations of the same columns and they drift silently otherwise.
"""

import ast
from pathlib import Path
from uuid import uuid4

from sqlalchemy import BigInteger
from sqlalchemy.dialects import postgresql

from ee.src.dbs.postgres.measurements.dbes import MeasurementValueDBE
from ee.src.dbs.postgres.measurements.mappings import measurement_component_to_row
from ee.tests.pytest.utils.wallets.builders import build_llm_component

MIGRATION = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/tracing_ee/versions/ee0000000002_add_measurements.py"
)

INT32_MAX = 2_147_483_647
INT64_MAX = 2**63 - 1

# Every `measurement_values` column that carries an unbounded number from the envelope.
METRIC_COLUMNS = ("value", "cost_musd")


def _migration_column_types() -> dict:
    """`column name -> rendered sa type` for every `sa.Column(...)` in the migration."""
    types = {}
    for node in ast.walk(ast.parse(MIGRATION.read_text())):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "Column"):
            continue
        name = node.args[0]
        if not (isinstance(name, ast.Constant) and isinstance(name.value, str)):
            continue
        types[name.value] = ast.unparse(node.args[1]) if len(node.args) > 1 else None
    return types


def test_metric_model_columns_are_64_bit():
    for name in METRIC_COLUMNS:
        column = MeasurementValueDBE.__table__.columns[name]

        assert isinstance(column.type, BigInteger), name
        assert column.type.compile(dialect=postgresql.dialect()) == "BIGINT", name


def test_metric_migration_columns_are_64_bit():
    declared = _migration_column_types()

    for name in METRIC_COLUMNS:
        assert declared[name] == "sa.BigInteger()", name


def test_a_component_above_the_32_bit_ceiling_reaches_the_row_intact():
    """The numbers the mapping hands Postgres are the gateway's own, unclamped: the
    columns are the only thing standing between them and an overflow on insert."""
    # $2500 of provider cost in millionths of a dollar, and a sandbox run measured in
    # msec that outran a 32-bit count — both over the ceiling.
    cost_musd = 2_500 * 1_000_000
    value = 3_000_000_000
    assert cost_musd > INT32_MAX and value > INT32_MAX
    assert cost_musd <= INT64_MAX and value <= INT64_MAX

    row = measurement_component_to_row(
        measurement_row_id=uuid4(),
        component=build_llm_component(
            key="input_tokens", value=value, cost_musd=cost_musd
        ),
    )

    assert row["value"] == value
    assert row["cost_musd"] == cost_musd
