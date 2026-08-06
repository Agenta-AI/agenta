"""prove the EE-only tracing chain advances independently of the other chains

Intentionally a no-op: its only observable effect is
alembic_version_ee moving from the root to this revision in EE only.
Mirrors the core EE-only chain proof (`ee0000000001`).

Revision ID: ee0000000001
Revises: ee0000000000
Create Date: 2026-06-14 00:00:04.000000

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
