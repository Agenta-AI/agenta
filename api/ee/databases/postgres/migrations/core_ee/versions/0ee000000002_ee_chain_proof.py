"""prove the EE-only chain advances independently of the shared chain

Intentionally a no-op: its only observable effect is alembic_version_ee
moving past the root in EE databases, while alembic_version_oss and the
parked alembic_version are untouched. OSS databases never see this chain.

Revision ID: 0ee000000002
Revises: 0ee000000001
Create Date: 2026-06-12 00:00:10.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "0ee000000002"
down_revision: Union[str, None] = "0ee000000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
