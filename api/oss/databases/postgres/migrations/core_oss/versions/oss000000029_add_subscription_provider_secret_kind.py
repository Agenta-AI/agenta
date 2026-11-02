"""add subscription_provider kind to secretkind_enum

A hosted subscription connection (a ChatGPT sign-in the platform stores and hands to a
run) is a vault secret like any other, so it needs one more label on the shared enum. The
row shape does not change.

This lives in the shared core_oss chain (it runs in both editions); the enum and the
secrets table are shared objects, so there is no EE-only copy.

Revision ID: oss000000029
Revises: oss000000028
Create Date: 2026-09-08 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "oss000000029"
down_revision: Union[str, None] = "oss000000028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PROVIDER'"
    )


def downgrade() -> None:
    # PostgreSQL cannot drop an enum value; the SUBSCRIPTION_PROVIDER label stays.
    pass
