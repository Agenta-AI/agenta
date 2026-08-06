"""drop nodes

Revision ID: cfa14a847972
Revises: fd77265d65dc
Create Date: 2025-11-16 11:29:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cfa14a847972"
down_revision: Union[str, None] = "fd77265d65dc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("nodes")


def downgrade() -> None:
    pass
