"""add mounts storage_prefix column, legacy fill trigger, and backfill

`mounts.storage_prefix` holds the mount's object-key prefix, relative to the store
namespace, with no leading or trailing slash. It is written once, in the insert, and
never updated, so a mount keeps its files when its `project_id` changes later. Every
row in this release stores the project layout, `mounts/<project_id>/<mount_id>`, which
is the key the previous release computes from `project_id`.

The `BEFORE INSERT` trigger exists for the rolling deploy. Pods of the previous release
insert mounts without the column, and Postgres checks NOT NULL on the proposed row
before it resolves `ON CONFLICT`, so without the trigger every insert and every re-bind
on those pods would fail. The trigger writes the same project layout those pods compute.
Code of this release always writes the column, so the `WHEN` guard is false for it.
The next release drops the trigger and its function.

Revision ID: oss000000050
Revises: oss000000043
Create Date: 2026-10-22 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "oss000000050"
down_revision: Union[str, None] = "oss000000043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CREATE_FILL_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION mounts_fill_legacy_storage_prefix() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.storage_prefix := 'mounts/' || NEW.project_id::text || '/' || NEW.id::text;
    RETURN NEW;
END;
$$;
"""

_CREATE_FILL_TRIGGER_SQL = """
CREATE TRIGGER trg_mounts_fill_legacy_storage_prefix
BEFORE INSERT ON mounts
FOR EACH ROW
WHEN (NEW.storage_prefix IS NULL)
EXECUTE FUNCTION mounts_fill_legacy_storage_prefix();
"""

_BACKFILL_STORAGE_PREFIX_SQL = """
UPDATE mounts
SET storage_prefix = 'mounts/' || project_id::text || '/' || id::text
WHERE storage_prefix IS NULL;
"""


def upgrade() -> None:
    # Fail fast instead of queueing behind long transactions; the deploy is retried.
    op.execute("SET LOCAL lock_timeout = '5s'")

    op.add_column("mounts", sa.Column("storage_prefix", sa.String(), nullable=True))

    op.execute(_CREATE_FILL_FUNCTION_SQL)
    op.execute(_CREATE_FILL_TRIGGER_SQL)
    op.execute(_BACKFILL_STORAGE_PREFIX_SQL)

    op.alter_column("mounts", "storage_prefix", nullable=False)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_mounts_fill_legacy_storage_prefix ON mounts")
    op.execute("DROP FUNCTION IF EXISTS mounts_fill_legacy_storage_prefix()")
    op.drop_column("mounts", "storage_prefix")
