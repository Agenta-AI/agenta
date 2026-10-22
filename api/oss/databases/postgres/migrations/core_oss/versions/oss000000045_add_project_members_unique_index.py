"""add a guarded unique index on project_members (project_id, user_id)

Revision ID: oss000000045
Revises: oss000000044
Create Date: 2026-10-22 00:00:00.000000

The membership writers insert project rows with `ON CONFLICT (project_id, user_id) DO
NOTHING`, and the resolver reads one row per (user, project). Both need at most one row
per pair, so this revision adds the unique index.

Duplicate rows stop the upgrade instead of being deleted here: the expected count is 0
or close to it, and the operator sees each role before it goes. The error names the
preflight script, `python -m entrypoints.memberships_check --apply`, which keeps the
oldest row of each group. `oss000000044` has already deleted the demo rows, so a demo
row and a real row in one project are not a duplicate here.

The index is built CONCURRENTLY, so the table stays writable while it builds. An
interrupted build leaves an invalid index that `IF NOT EXISTS` skips; the upgrade checks
validity and stops with the repair instruction, as `oss000000040` does. Old pods only
insert project rows for new signups (demo enrollment), which the index never rejects.
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000045"
down_revision: Union[str, None] = "oss000000044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_INDEX_NAME = "ux_project_members_project_id_user_id"

_COUNT_DUPLICATE_GROUPS_SQL = """
SELECT count(*) FROM (
    SELECT 1 FROM project_members
    GROUP BY project_id, user_id
    HAVING count(*) > 1
) duplicates
"""


def _guard_no_duplicates(bind) -> None:
    duplicates = bind.execute(text(_COUNT_DUPLICATE_GROUPS_SQL)).scalar() or 0
    if duplicates:
        raise RuntimeError(
            f"project_members has {duplicates} duplicate (project_id, user_id) groups. "
            "Run python -m entrypoints.memberships_check --apply, which keeps the "
            "oldest row of each group, then rerun the migration."
        )


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction.
    with op.get_context().autocommit_block():
        bind = op.get_bind()

        _guard_no_duplicates(bind)

        op.execute(
            f"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS {_INDEX_NAME} "
            "ON project_members (project_id, user_id)"
        )

        # IF NOT EXISTS skips an invalid index left by an interrupted build, so stop
        # here instead of recording the revision without the index.
        is_valid = bind.execute(
            text(
                "SELECT indisvalid FROM pg_catalog.pg_index "
                "WHERE indexrelid = pg_catalog.to_regclass(:name)"
            ),
            {"name": _INDEX_NAME},
        ).scalar()
        if is_valid is not True:
            raise RuntimeError(
                f"Index {_INDEX_NAME} is missing or invalid. Run "
                f"REINDEX INDEX CONCURRENTLY {_INDEX_NAME} outside a transaction, "
                "then rerun the migration."
            )

        op.execute("ANALYZE project_members")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_INDEX_NAME}")
