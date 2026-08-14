"""llms_endpoints.provider_key nullable

D34 forbids body conversion, so `select_upstream`'s `direct` branch (the one place a
stored row's `provider_key` decided anything, entities.md §2.4) is gone. The column stays —
`query_endpoints` filters on it and an upstream error names it — but a `custom` row pointed
at a self-hosted gateway no longer has to name a provider that means nothing to it.

Revision ID: oss000000022
Revises: oss000000021
Create Date: 2026-08-14 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import String

revision: str = "oss000000022"
down_revision: Union[str, None] = "oss000000021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "llms_endpoints"
_COLUMN = "provider_key"


def upgrade() -> None:
    op.alter_column(_TABLE, _COLUMN, existing_type=String(), nullable=True)


def downgrade() -> None:
    # A NULL provider_key can only exist on a row written after this migration (the DTO
    # requires nothing older). Label unlabeled rows rather than fail the downgrade outright.
    op.execute(f"UPDATE {_TABLE} SET {_COLUMN} = 'custom' WHERE {_COLUMN} IS NULL")
    op.alter_column(_TABLE, _COLUMN, existing_type=String(), nullable=False)
