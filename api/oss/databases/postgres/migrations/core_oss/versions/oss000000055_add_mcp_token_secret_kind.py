"""add the mcp_token secret kind

A person's pasted token for a project's MCP server is a `secrets` row of kind
`MCP_TOKEN`, at the slug `token_slug(server id)`. The value has its own revision because
Postgres cannot use a new enum value in the transaction that adds it, and revision
oss000000056 names it in a check.

Revision ID: oss000000055
Revises: oss000000053
Create Date: 2026-10-29 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000055"
down_revision: Union[str, None] = "oss000000053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'MCP_TOKEN'")


def downgrade() -> None:
    # Postgres cannot drop an enum value. Revision oss000000056 deletes the rows of this
    # kind on its downgrade, so the unused value stays.
    pass
