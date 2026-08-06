"""repair remaining malformed evaluation/evaluator data

Revision ID: b3f6bff547d4
Revises: 4d9a58ff8f98
Create Date: 2024-10-10 21:56:26.901827

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b3f6bff547d4"
down_revision: Union[str, None] = "4d9a58ff8f98"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if "evaluators_configs" not in inspector.get_table_names():
        # Check if app_id exists in the evaluators_configs table
        columns = [
            column["name"] for column in inspector.get_columns("evaluators_configs")
        ]
        if "app_id" in columns:
            op.drop_column("evaluators_configs", "app_id")


def downgrade() -> None:
    op.add_column(
        "evaluators_configs",
        sa.Column("app_id", sa.UUID(), autoincrement=False, nullable=True),
    )
