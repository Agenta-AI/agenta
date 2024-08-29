"""Merge conflicting heads

Revision ID: 78cde3fc549c
Revises: 1abfef8ed0ef, 5c29a64204f4
Create Date: 2024-08-29 22:01:35.030820

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "78cde3fc549c"
down_revision: Union[str, None] = ("1abfef8ed0ef", "5c29a64204f4")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
