"""add events table

Revision ID: a0b1c2d3e4f5
Revises: e5f6a1b2c3d4
Create Date: 2026-03-01 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, None] = "e5f6a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

request_type_enum = sa.Enum("unknown", name="requesttype")


def upgrade() -> None:
    request_type_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "events",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("request_type", request_type_enum, nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("timestamp", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("status_code", sa.String(), nullable=True),
        sa.Column("status_message", sa.String(), nullable=True),
        sa.Column(
            "attributes",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "request_id", "event_id"),
    )

    op.create_index(
        "ix_events_project_id",
        "events",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "ix_events_project_id_request_id",
        "events",
        ["project_id", "request_id"],
        unique=False,
    )
    op.create_index(
        "ix_events_project_id_event_id",
        "events",
        ["project_id", "event_id"],
        unique=False,
    )
    op.create_index(
        "ix_events_project_id_timestamp",
        "events",
        ["project_id", "timestamp"],
        unique=False,
    )
    op.create_index(
        "ix_events_project_id_request_type",
        "events",
        ["project_id", "request_type"],
        unique=False,
    )
    op.create_index(
        "ix_events_project_id_event_type",
        "events",
        ["project_id", "event_type"],
        unique=False,
    )
    op.create_index(
        "ix_events_project_id_request_id_created_at",
        "events",
        ["project_id", "request_id", sa.text("created_at DESC")],
        unique=False,
    )
    op.create_index(
        "ix_events_attributes_gin",
        "events",
        ["attributes"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_events_fts_attributes_gin",
        "events",
        [sa.text("to_tsvector('simple', attributes)")],
        unique=False,
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_events_fts_attributes_gin", table_name="events")
    op.drop_index("ix_events_attributes_gin", table_name="events")
    op.drop_index("ix_events_project_id_request_id_created_at", table_name="events")
    op.drop_index("ix_events_project_id_event_type", table_name="events")
    op.drop_index("ix_events_project_id_request_type", table_name="events")
    op.drop_index("ix_events_project_id_timestamp", table_name="events")
    op.drop_index("ix_events_project_id_event_id", table_name="events")
    op.drop_index("ix_events_project_id_request_id", table_name="events")
    op.drop_index("ix_events_project_id", table_name="events")
    op.drop_table("events")
    request_type_enum.drop(op.get_bind(), checkfirst=True)
