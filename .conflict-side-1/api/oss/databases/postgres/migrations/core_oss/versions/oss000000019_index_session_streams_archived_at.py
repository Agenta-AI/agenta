"""index session_streams (project_id, archived_at)

Backs the archive/unarchive lifecycle: the durable list filters `archived_at` per project (the
default list excludes it; the archived view selects it), so give that predicate an index instead
of leaning on the created_at index alone. Mirrors `ix_session_streams_project_id_created_at`.

Revision ID: oss000000019
Revises: oss000000018
Create Date: 2026-07-22 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000019"
down_revision: Union[str, None] = "oss000000018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_session_streams_project_id_archived_at",
        "session_streams",
        ["project_id", "archived_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_streams_project_id_archived_at",
        table_name="session_streams",
    )
