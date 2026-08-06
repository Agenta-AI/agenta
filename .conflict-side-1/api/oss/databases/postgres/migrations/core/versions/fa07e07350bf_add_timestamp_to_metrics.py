"""add timestamp to metrics

Revision ID: fa07e07350bf
Revises: 30dcf07de96a
Create Date: 2025-07-30 14:55:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "fa07e07350bf"
down_revision: Union[str, None] = "30dcf07de96a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "evaluation_metrics",
        sa.Column("timestamp", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "evaluation_metrics",
        sa.Column("interval", sa.INTEGER(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("evaluation_metrics", "interval")
    op.drop_column("evaluation_metrics", "timestamp")
