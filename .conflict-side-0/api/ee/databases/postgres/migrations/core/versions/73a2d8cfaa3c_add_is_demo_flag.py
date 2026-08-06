"""add initial demo

Revision ID: 73a2d8cfaa3c
Revises: 24f8bdb390ee
Create Date: 2024-12-02 9:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "73a2d8cfaa3c"
down_revision: Union[str, None] = "24f8bdb390ee"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### custom data migrations ###
    op.add_column("project_members", sa.Column("is_demo", sa.BOOLEAN(), nullable=True))
    # ### end of custom data commands ###


def downgrade() -> None:
    # ### custom data migrations ###
    op.drop_column("project_members", "is_demo")
    # ### end of custom data commands ###
