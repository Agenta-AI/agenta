"""park the legacy chain at the alignment point

Final revision of the legacy core chain. Both editions' legacy chains end at
this same revision id, so a database migrated by either edition parks
`alembic_version` at an id the other edition can resolve. All migrations from
this point on live in the post-alignment chains (`alembic_version_oss`, and
for EE also `alembic_version_ee`). See
docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md.

Revision ID: a1167e5b0001
Revises: 4f5a6b7c8d9e
Create Date: 2026-06-12 00:00:06.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "a1167e5b0001"
down_revision: Union[str, None] = "4f5a6b7c8d9e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
