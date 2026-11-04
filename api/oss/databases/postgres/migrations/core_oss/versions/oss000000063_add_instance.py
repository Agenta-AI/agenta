"""add the deployment instance row

Revision ID: oss000000063
Revises: oss000000062
Create Date: 2026-11-04 00:00:00.000000

- `instances` holds one row: the id of this deployment. It is created once and kept
  across upgrades, so analytics can count deployments and keep two deployments apart.
- `preexisting` is true when the deployment already had users before this migration,
  so an upgrade is not counted as a new deployment.
- `announced_at` is set after the API reports the instance to analytics, so the
  report is sent once.

Old code on the new schema ignores the table.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000063"
down_revision: Union[str, None] = "oss000000062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS instances (
            id UUID PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            preexisting BOOLEAN NOT NULL DEFAULT false,
            announced_at TIMESTAMPTZ NULL
        )
        """
    )
    op.execute(
        """
        INSERT INTO instances (id, preexisting)
        SELECT gen_random_uuid(), EXISTS (SELECT 1 FROM users)
        WHERE NOT EXISTS (SELECT 1 FROM instances)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS instances")
