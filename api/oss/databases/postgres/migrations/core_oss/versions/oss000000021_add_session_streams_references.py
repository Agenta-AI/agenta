"""add references to session_streams

References rode only on `session_turns`, appended fire-and-forget after a run starts. When
that append never lands — or lands with the caller's partial reference set — the session
row itself says nothing about what it runs, and the list has no id to open it with. Give
the row its own copy, filled once at run time and never overwritten, so a dropped turn
append can no longer strand a session.

Nullable, and indexed the same way `session_turns.references` is: the reference-scoped
session filter resolves ids through BOTH columns and unions them, so this one is on a
`@>` containment path too and needs the same GIN `jsonb_path_ops` index to stay off a
sequential scan.

Revision ID: oss000000021
Revises: oss000000020
Create Date: 2026-08-12 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "oss000000021"
down_revision: Union[str, None] = "oss000000020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_streams",
        sa.Column(
            "references",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_session_streams_references",
        "session_streams",
        ["references"],
        postgresql_using="gin",
        postgresql_ops={"references": "jsonb_path_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_session_streams_references", table_name="session_streams")
    op.drop_column("session_streams", "references")
