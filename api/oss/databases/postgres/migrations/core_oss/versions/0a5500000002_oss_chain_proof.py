"""prove the shared chain advances independently of the parked legacy chain

Intentionally a no-op: its only observable effect is alembic_version_oss
moving from the root to this revision in both editions.

Revision ID: 0a5500000002
Revises: 0a5500000001
Create Date: 2026-06-12 00:00:09.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "0a5500000002"
down_revision: Union[str, None] = "0a5500000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
