"""add_transcripts

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-06-28 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "transcripts",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("event_index", sa.Integer(), nullable=True),
        sa.Column("sender", sa.String(), nullable=True),
        sa.Column("session_update", sa.String(), nullable=True),
        sa.Column(
            "payload",
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
        sa.PrimaryKeyConstraint("project_id", "id"),
    )

    op.create_index(
        "ix_transcripts_project_id",
        "transcripts",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "ix_transcripts_project_id_session_id",
        "transcripts",
        ["project_id", "session_id"],
        unique=False,
    )
    op.create_index(
        "ix_transcripts_project_id_id",
        "transcripts",
        ["project_id", "id"],
        unique=False,
    )
    op.create_index(
        "ix_transcripts_project_id_session_id_id",
        "transcripts",
        ["project_id", "session_id", "id"],
        unique=False,
    )
    op.create_index(
        "ix_transcripts_payload_gin",
        "transcripts",
        ["payload"],
        unique=False,
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_transcripts_payload_gin", table_name="transcripts")
    op.drop_index("ix_transcripts_project_id_session_id_id", table_name="transcripts")
    op.drop_index("ix_transcripts_project_id_id", table_name="transcripts")
    op.drop_index("ix_transcripts_project_id_session_id", table_name="transcripts")
    op.drop_index("ix_transcripts_project_id", table_name="transcripts")
    op.drop_table("transcripts")
