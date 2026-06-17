"""prove the EE-only chain advances independently of the shared chain

Intentionally a no-op: its only observable effect is alembic_version_ee
moving past the root in EE databases, while alembic_version_oss and the
parked alembic_version are untouched. OSS databases never see this chain.

Revision ID: ee0000000001
Revises: ee0000000000
Create Date: 2026-06-12 00:00:10.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "ee0000000001"
down_revision: Union[str, None] = "ee0000000000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
