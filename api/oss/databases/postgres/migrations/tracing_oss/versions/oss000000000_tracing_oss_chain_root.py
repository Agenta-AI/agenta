"""root of the post-alignment shared (oss) tracing chain

Runs in both editions, tracked in alembic_version_tracing_oss. Requires the
legacy tracing chain to be parked at the align revision (the runner asserts
this). Mirrors the core shared chain root (`oss000000000`).

Revision ID: oss000000000
Revises:
Create Date: 2026-06-14 00:00:01.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "oss000000000"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
