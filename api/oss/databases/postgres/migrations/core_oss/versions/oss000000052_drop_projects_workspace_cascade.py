"""drop the workspace cascade from projects and allow projects without a workspace

Step 1 of workspace removal. Projects stop depending on `workspaces`: every foreign key
from `projects.workspace_id` to `workspaces` goes (found by its definition, not by its
name, so a deployment whose constraint has another name is covered too), and the column
becomes nullable so the next step can stop writing it. Code of this release still writes
a workspace for every project; it also serves projects without one, which the next step
writes. A workspace row deleted directly in the database no longer deletes its projects;
the admin deletes now delete them explicitly.

The statements change only the catalog, but they take an ACCESS EXCLUSIVE lock on
`projects` and `workspaces`. The short lock timeout bounds how long requests queue behind
a waiting lock request; on a timeout the hook fails cleanly and the deploy is retried.
The migration gate reports one warning (`drop_constraint`) and passes.

Revision ID: oss000000052
Revises: oss000000051
Create Date: 2026-10-24 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "oss000000052"
down_revision: Union[str, None] = "oss000000051"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FIND_WORKSPACE_FOREIGN_KEYS_SQL = """
SELECT c.conname
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND c.conrelid = 'projects'::regclass
  AND c.confrelid = 'workspaces'::regclass
  AND a.attname = 'workspace_id'
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")

    names = [
        row.conname
        for row in op.get_bind().execute(sa.text(_FIND_WORKSPACE_FOREIGN_KEYS_SQL))
    ]
    for name in names:
        op.drop_constraint(name, "projects", type_="foreignkey")

    op.alter_column(
        "projects",
        "workspace_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )


def downgrade() -> None:
    """Fails when projects without a workspace exist (written by the next step): correct,
    because such rows cannot satisfy the old constraint."""
    op.execute("SET LOCAL lock_timeout = '2s'")

    op.alter_column(
        "projects",
        "workspace_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.create_foreign_key(
        "projects_workspace_id_fkey",
        "projects",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
