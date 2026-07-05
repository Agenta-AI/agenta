"""drop enum types orphaned by the nodes drop

cfa14a847972 dropped the nodes table but DROP TABLE leaves enum types
behind; no live column uses nodetype or treetype (spans uses spantype,
tracetype, otelspankind, otelstatuscode).

Revision ID: f3a4b5c6d7e8
Revises: d1e2f3a4b5c6
Create Date: 2026-06-12 00:00:03.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('DROP TYPE IF EXISTS "nodetype"')
    op.execute('DROP TYPE IF EXISTS "treetype"')


def downgrade() -> None:
    pass
