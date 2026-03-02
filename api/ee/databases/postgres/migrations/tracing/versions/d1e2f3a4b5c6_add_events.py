"""add_events

Revision ID: d1e2f3a4b5c6
Revises: a2b3c4d5e6f7
Create Date: 2026-02-23 17:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column(
            "request_type", sa.Enum("UNKNOWN", name="requesttype"), nullable=False
        ),
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
        sa.Column(
            "created_by_id", sa.UUID(), nullable=True
        ),  # nullable: events are system-generated, not user-created
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.PrimaryKeyConstraint("project_id", "request_id", "event_id"),
    )

    op.create_index("ix_events_project_id", "events", ["project_id"], unique=False)
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
    op.execute("DROP TYPE IF EXISTS requesttype;")
