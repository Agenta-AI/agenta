"""Add Spans v2

Revision ID: 58b1b61e5d6c
Revises:
Create Date: 2025-03-28 12:22:05.104488

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "58b1b61e5d6c"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "spans",
        sa.Column(
            "project_id",
            sa.UUID(),
            # sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column(
            "deleted_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "updated_by_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "deleted_by_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "trace_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "span_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "span_kind",
            sa.Enum(
                "SPAN_KIND_UNSPECIFIED",
                "SPAN_KIND_INTERNAL",
                "SPAN_KIND_SERVER",
                "SPAN_KIND_CLIENT",
                "SPAN_KIND_PRODUCER",
                "SPAN_KIND_CONSUMER",
                name="otelspankind",
            ),
            nullable=False,
        ),
        sa.Column(
            "span_name",
            sa.VARCHAR(),
            nullable=False,
        ),
        sa.Column(
            "start_time",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "end_time",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "status_code",
            sa.Enum(
                "STATUS_CODE_UNSET",
                "STATUS_CODE_OK",
                "STATUS_CODE_ERROR",
                name="otelstatuscode",
            ),
            nullable=False,
        ),
        sa.Column(
            "status_message",
            sa.VARCHAR(),
            nullable=True,
        ),
        sa.Column(
            "attributes",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "events",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "links",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "references",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        # sa.Column(
        #     "content",
        #     sa.VARCHAR(),
        #     nullable=True,
        # ),
        sa.PrimaryKeyConstraint(
            "project_id",
            "trace_id",
            "span_id",
        ),
        sa.Index(
            "ix_project_id_trace_id",
            "project_id",
            "trace_id",
        ),
        sa.Index(
            "ix_project_id_span_id",
            "project_id",
            "span_id",
        ),
        sa.Index(
            "ix_project_id_start_time",
            "project_id",
            "start_time",
        ),
        sa.Index(
            "ix_project_id",
            "project_id",
        ),
        sa.Index(
            "ix_attributes_gin",
            "attributes",
            postgresql_using="gin",
        ),
        sa.Index(
            "ix_events_gin",
            "events",
            postgresql_using="gin",
        ),
        sa.Index(
            "ix_links_gin",
            "links",
            postgresql_using="gin",
        ),
        sa.Index(
            "ix_references_gin",
            "references",
            postgresql_using="gin",
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_references_gin", table_name="spans")
    op.drop_index("ix_links_gin", table_name="spans")
    op.drop_index("ix_events_gin", table_name="spans")
    op.drop_index("ix_attributes_gin", table_name="spans")
    op.drop_index("ix_project_id", table_name="spans")
    op.drop_index("ix_project_id_start_time", table_name="spans")
    op.drop_index("ix_project_id_span_id", table_name="spans")
    op.drop_index("ix_project_id_trace_id", table_name="spans")
    op.drop_table("spans")
