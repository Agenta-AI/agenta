"""drop the workspace tables and projects.workspace_id

Step 3 of workspace removal (design.md D5, "contract"). Step 2b removed every read and
write of these objects from the code and their ORM mappings, so the pods of the previous
release (step 2b) serve while this runs and after. One transaction, in this order:

1. Drop `workspace_members` (its foreign keys and indexes go with it).
2. Drop `workspaces`.
3. Drop `projects.workspace_id` (no foreign key since oss000000052).

The drops do not cascade: when another object (a hand-made foreign key or view) still
depends on a workspace table, Postgres refuses the drop, names the object, and the
transaction changes nothing.

Locks: each drop takes an ACCESS EXCLUSIVE lock on its table for a moment, and the
dropped foreign keys take a short lock on `organizations` and `users`. `lock_timeout` is
2 s, so the revision fails and can be retried rather than queue behind a long
transaction and stall requests.

One-way: the rows of both tables and the old workspace of every project are gone. Take
the dump of `workspaces`, `workspace_members` and `projects` before the release.
`downgrade()` recreates the empty tables and a NULL column with the schema they had, so
that a restored dump fits; it brings no data back.

Revision ID: oss000000056
Revises: oss000000055
Create Date: 2026-10-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000056"
down_revision: Union[str, None] = "oss000000055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    op.execute("DROP TABLE IF EXISTS workspace_members")
    op.execute("DROP TABLE IF EXISTS workspaces")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS workspace_id")


def downgrade() -> None:
    """Schema only: empty tables and a NULL column, as before this revision. The data
    comes back only from the pre-release dump."""

    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id uuid")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS workspaces (
            id uuid PRIMARY KEY,
            name varchar,
            type varchar,
            description varchar,
            organization_id uuid NOT NULL
                REFERENCES organizations(id) ON DELETE CASCADE,
            created_at timestamptz,
            updated_at timestamptz,
            deleted_at timestamptz,
            created_by_id uuid,
            updated_by_id uuid,
            deleted_by_id uuid
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS workspace_members (
            id uuid PRIMARY KEY,
            user_id uuid REFERENCES users(id) ON DELETE CASCADE,
            workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
            role varchar,
            created_at timestamptz,
            updated_at timestamptz,
            deleted_at timestamptz,
            created_by_id uuid,
            updated_by_id uuid,
            deleted_by_id uuid
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workspace_members_workspace_id "
        "ON workspace_members (workspace_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workspace_members_user_id_workspace_id "
        "ON workspace_members (user_id, workspace_id)"
    )
