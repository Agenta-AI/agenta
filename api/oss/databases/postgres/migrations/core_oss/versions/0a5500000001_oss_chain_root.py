"""root of the post-alignment shared (oss) chain

Runs in both editions, tracked in alembic_version_oss. Requires the legacy
chain to be parked at the align revision (the runner asserts this).

Revision ID: 0a5500000001
Revises:
Create Date: 2026-06-12 00:00:07.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "0a5500000001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
