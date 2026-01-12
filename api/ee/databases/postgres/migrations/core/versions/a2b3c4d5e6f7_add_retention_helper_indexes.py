"""Add retention helper indexes on projects/subscriptions

Revision ID: a2b3c4d5e6f7
Revises: c3b2a1d4e5f6
Create Date: 2025-01-06 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, None] = "c3b2a1d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY must run outside a transaction
    conn = op.get_bind()
    conn = conn.execution_options(isolation_level="AUTOCOMMIT")

    # Index for projects -> subscriptions join
    conn.execute(
        text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_projects_organization_id
        ON public.projects (organization_id);
    """)
    )

    # Index for plan-based lookups
    conn.execute(
        text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_subscriptions_plan
        ON public.subscriptions (plan);
    """)
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn = conn.execution_options(isolation_level="AUTOCOMMIT")

    conn.execute(
        text("DROP INDEX CONCURRENTLY IF EXISTS public.ix_projects_organization_id;")
    )
    conn.execute(
        text("DROP INDEX CONCURRENTLY IF EXISTS public.ix_subscriptions_plan;")
    )
