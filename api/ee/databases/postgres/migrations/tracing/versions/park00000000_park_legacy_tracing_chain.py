"""park the legacy tracing chain at the alignment point

Final revision of the legacy tracing chain. Both editions' legacy tracing
chains end at this same revision id, so a tracing database migrated by either
edition parks its `alembic_version` at an id the other edition can resolve.
All tracing migrations from this point on live in the post-alignment chains
(`alembic_version_oss`, and for EE also `alembic_version_ee`).
Mirrors the core chain park (`park00000000`). See
docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md.

Revision ID: park00000000
Revises: a4b5c6d7e8f9
Create Date: 2026-06-14 00:00:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "park00000000"
down_revision: Union[str, None] = "a4b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
