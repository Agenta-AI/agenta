"""Unify organization_members.role 'member' to 'viewer'

Aligns the organization scope with workspace/project scopes on a single
least-permission role slug. The runtime access-controls layer
(`ee.src.core.entitlements.controls`) treats `viewer` as the per-scope
minima for every scope; this migration brings stored data and the column
default in line with that.

- Rewrites every row with role='member' to role='viewer'.
- Changes the column server default from 'member' to 'viewer'.

The downgrade reverses both, restoring the previous behavior.

Revision ID: a1b2c3d4e5f7
Revises: 9d3e8f0a1b2c
Create Date: 2026-05-13 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, None] = "9d3e8f0a1b2c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        text("UPDATE organization_members SET role = 'viewer' WHERE role = 'member'")
    )

    op.alter_column(
        "organization_members",
        "role",
        server_default="viewer",
        existing_type=sa.String(),
        existing_nullable=False,
    )


def downgrade() -> None:
    conn = op.get_bind()

    op.alter_column(
        "organization_members",
        "role",
        server_default="member",
        existing_type=sa.String(),
        existing_nullable=False,
    )

    conn.execute(
        text("UPDATE organization_members SET role = 'member' WHERE role = 'viewer'")
    )
