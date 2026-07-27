"""add expression index for gateway_connections provider account lookups

find_connection_by_provider_id / activate_connection_by_provider_connection_id
(the OAuth-callback hot path, called on every Composio connect completion)
filter on project_id + data->>'connected_account_id' with no index backing the
JSON key extraction, forcing a per-project sequential scan. Add a btree
expression index on the extracted text (the `data` column is plain `json`,
not `jsonb`, so a GIN path-ops index isn't an option here).

Revision ID: oss000000012
Revises: oss000000011
Create Date: 2026-07-13 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000012"
down_revision: Union[str, None] = "oss000000011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction.
    with op.get_context().autocommit_block():
        op.execute(
            text(
                """
                CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_gateway_connections_project_id_connected_account_id
                ON gateway_connections (project_id, (data ->> 'connected_account_id'));
                """
            )
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            text(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "ix_gateway_connections_project_id_connected_account_id;"
            )
        )
