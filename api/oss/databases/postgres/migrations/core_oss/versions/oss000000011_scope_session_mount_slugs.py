"""scope session mount slugs (__ag__<uuid5>__<key> -> __ag__session__<uuid5>__<key>)

Reserved mount slugs are now scoped `__ag__<scope>__<id>__<key>` so each binding
kind (session, agent, ...) is unique per scope. Agent mounts already mint
`__ag__agent__...`; session mounts minted the pre-scope `__ag__<uuid5>__<key>`.
The session-cwd upsert keys on unique(project_id, slug) with a deterministic
slug, so un-migrated rows would be orphaned (a re-attached session would mint a
NEW mount and lose its durable prefix). Rewrite them in place; storage keys are
`<project_id>/<mount_id>`-based and slug-independent, so no object moves.

Revision ID: oss000000011
Revises: oss000000010
Create Date: 2026-07-13 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000011"
down_revision: Union[str, None] = "oss000000010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Pre-scope rows are exactly the reserved slugs with no scope segment: the
    # segment after `__ag__` is a uuid5, never the literal `session`/`agent`.
    conn.execute(
        sa.text(
            """
            UPDATE mounts
            SET slug = '__ag__session__' || substr(slug, 7)
            WHERE left(slug, 6) = '__ag__'
              AND left(slug, 15) <> '__ag__session__'
              AND left(slug, 13) <> '__ag__agent__'
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            """
            UPDATE mounts
            SET slug = '__ag__' || substr(slug, 16)
            WHERE left(slug, 15) = '__ag__session__'
            """
        )
    )
