"""rename tool_connections to gateway_connections

Connection ownership moves out of /tools into the shared, routerless
connections domain (gateway-triggers WP0). Rename-only — no data transform.
Authored once in the shared core_oss chain so it runs in BOTH editions; the
legacy chain that created tool_connections is parked.

Revision ID: oss000000002
Revises: oss000000001
Create Date: 2026-06-18 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "oss000000002"
down_revision: Union[str, None] = "oss000000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.rename_table("tool_connections", "gateway_connections")
    op.execute(
        "ALTER TABLE gateway_connections "
        "RENAME CONSTRAINT uq_tool_connections_project_provider_integration_slug "
        "TO uq_gateway_connections_project_provider_integration_slug"
    )
    op.execute(
        "ALTER INDEX ix_tool_connections_project_provider_integration "
        "RENAME TO ix_gateway_connections_project_provider_integration"
    )


def downgrade() -> None:
    op.execute(
        "ALTER INDEX ix_gateway_connections_project_provider_integration "
        "RENAME TO ix_tool_connections_project_provider_integration"
    )
    op.execute(
        "ALTER TABLE gateway_connections "
        "RENAME CONSTRAINT uq_gateway_connections_project_provider_integration_slug "
        "TO uq_tool_connections_project_provider_integration_slug"
    )
    op.rename_table("gateway_connections", "tool_connections")
