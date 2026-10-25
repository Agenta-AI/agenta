"""drop the mounts legacy storage_prefix fill trigger and its function

Revision `oss000000050` added a `BEFORE INSERT` trigger that wrote the project layout into
`mounts.storage_prefix` for pods that did not know the column. Every pod of the release
before this one writes the prefix itself in the insert, so the trigger has no caller left
and goes. From this release new mounts store the organization layout,
`mounts/<organization_id>/<mount_id>`; rows that exist keep their stored prefix.

A deployment that skips the release before (pods without the column still running during
the rollout) runs 050 and 051 in one hook. Its old pods then fail mount inserts with a NOT
NULL error until they are replaced. Upgrade through that release for a clean rolling upgrade.

The statements change only the catalog, but they take an ACCESS EXCLUSIVE lock on `mounts`.
The short lock timeout bounds how long requests queue behind a waiting lock request; on a
timeout the hook fails cleanly and the deploy is retried.

Revision ID: oss000000051
Revises: oss000000049
Create Date: 2026-10-24 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000051"
down_revision: Union[str, None] = "oss000000049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Copied from oss000000050, not imported: a revision must not depend on another one's code.
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


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")

    op.execute("DROP TRIGGER IF EXISTS trg_mounts_fill_legacy_storage_prefix ON mounts")
    op.execute("DROP FUNCTION IF EXISTS mounts_fill_legacy_storage_prefix()")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")

    op.execute(_CREATE_FILL_FUNCTION_SQL)
    op.execute(_CREATE_FILL_TRIGGER_SQL)
