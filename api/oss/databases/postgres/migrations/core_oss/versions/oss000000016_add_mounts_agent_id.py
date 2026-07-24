"""add mounts agent_id column, index, and backfill

Mirrors session_id: a bare, nullable varchar populated only for agent mounts
(session mounts stay agent_id-null), with a partial index for querying "mounts
for agent X" the same way session_id already supports "mounts for session X".

Backfill: mounts are core DB, so a data migration is allowed here (unlike the
tracing DB). Agent-mount slugs are minted as
`__ag__agent__<canonical_artifact_id>__<name>` (`mint_agent_slug`,
`core/mounts/service.py`) — the artifact id is the raw canonical (lowercase)
UUID, not a hash, so it is deterministically recoverable straight out of the
slug. Session-mount slugs (`__ag__session__<uuid5(session_id)>__<name>`) hash
the session id, so no session_id backfill is possible or attempted here.

Revision ID: oss000000016
Revises: oss000000015
Create Date: 2026-07-17 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "oss000000016"
down_revision: Union[str, None] = "oss000000015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_AGENT_SLUG_PREFIX = "__ag__agent__"


def upgrade() -> None:
    op.add_column("mounts", sa.Column("agent_id", sa.String(), nullable=True))

    op.create_index(
        "ix_mounts_project_id_agent_id",
        "mounts",
        ["project_id", "agent_id"],
        unique=False,
        postgresql_where=sa.text("agent_id IS NOT NULL"),
    )

    conn = op.get_bind()
    conn.execute(
        sa.text(
            f"""
            UPDATE mounts
            SET agent_id = split_part(substr(slug, {len(_AGENT_SLUG_PREFIX) + 1}), '__', 1)
            WHERE left(slug, {len(_AGENT_SLUG_PREFIX)}) = '{_AGENT_SLUG_PREFIX}'
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_mounts_project_id_agent_id", table_name="mounts")
    op.drop_column("mounts", "agent_id")
