"""fix spans

Revision ID: fd77265d65dc
Revises: 847972cfa14a
Create Date: 2025-05-29 16:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from oss.src.core.tracing.dtos import SpanType
from oss.src.core.tracing.dtos import TraceType

# revision identifiers, used by Alembic.
revision: str = "fd77265d65dc"
down_revision: Union[str, None] = "847972cfa14a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # - SPANS ------------------------------------------------------------------
    trace_type_enum = sa.Enum(TraceType, name="tracetype")
    span_type_enum = sa.Enum(SpanType, name="spantype")

    trace_type_enum.create(op.get_bind(), checkfirst=True)
    span_type_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "spans",
        sa.Column(
            "trace_type",
            trace_type_enum,
            nullable=True,
        ),
    )
    op.add_column(
        "spans",
        sa.Column(
            "span_type",
            span_type_enum,
            nullable=True,
        ),
    )
    op.add_column(
        "spans",
        sa.Column(
            "hashes",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "spans",
        sa.Column(
            "exception",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_spans_project_id_trace_type",
        "spans",
        ["project_id", "trace_type"],
    )
    op.create_index(
        "ix_spans_project_id_span_type",
        "spans",
        ["project_id", "span_type"],
    )
    op.create_index(
        "ix_hashes_gin",
        "spans",
        ["hashes"],
        postgresql_using="gin",
        postgresql_ops={"hashes": "jsonb_path_ops"},
    )
    op.create_index(
        "ix_spans_fts_gin",
        "spans",
        [sa.text("to_tsvector('simple', attributes)")],
        postgresql_using="gin",
    )
    # op.create_index(
    #     "ix_spans_fts_events_gin",
    #     "spans",
    #     [sa.text("to_tsvector('simple', events)")],
    #     postgresql_using="gin",
    # )
    # --------------------------------------------------------------------------


def downgrade() -> None:
    # - SPANS ------------------------------------------------------------------
    # op.drop_index("ix_spans_fts", table_name="spans")
    op.drop_index("ix_hashes_gin", table_name="spans")
    op.drop_index("ix_spans_project_id_span_type", table_name="spans")
    op.drop_index("ix_spans_project_id_trace_type", table_name="spans")
    op.drop_column("spans", "exception")
    op.drop_column("spans", "hashes")
    op.drop_column("spans", "span_type")
    op.drop_column("spans", "trace_type")

    span_type_enum = sa.Enum(SpanType, name="tracetype")
    trace_type_enum = sa.Enum(TraceType, name="spantype")

    span_type_enum.drop(op.get_bind(), checkfirst=True)
    trace_type_enum.drop(op.get_bind(), checkfirst=True)
    # --------------------------------------------------------------------------
