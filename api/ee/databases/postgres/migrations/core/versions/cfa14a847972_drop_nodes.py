"""drop nodes

Revision ID: cfa14a847972
Revises: a1b2c3d4e5f6
Create Date: 2025-11-16 11:29:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cfa14a847972"
down_revision: Union[str, None] = "b2c3d4e5f6a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("nodes")


def downgrade() -> None:
    pass
