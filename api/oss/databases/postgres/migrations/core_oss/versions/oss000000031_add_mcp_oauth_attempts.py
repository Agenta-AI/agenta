"""Add server-side MCP OAuth authorization attempts.

The PKCE verifier and the identity of an in-flight OAuth connection used to travel to
the authorization server inside the `state` parameter, signed but readable. They live
here instead, addressed by an opaque single-use handle. Rows are short-lived: the
callback consumes one, and a cron sweep deletes whatever nobody came back for.

Revision ID: oss000000031
Revises: oss000000030
Create Date: 2026-09-13 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "oss000000031"
down_revision: Union[str, None] = "oss000000030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mcps_oauth_attempts",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("endpoint_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("server_url", sa.String(), nullable=False),
        sa.Column("issuer", sa.String(), nullable=False),
        sa.Column("token_endpoint", sa.String(), nullable=False),
        sa.Column("redirect_uri", sa.String(), nullable=False),
        sa.Column("resource", sa.String(), nullable=True),
        sa.Column("code_verifier", sa.String(), nullable=False),
        sa.Column("scopes", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("strategy", sa.String(), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        # `id` alone, unlike the `(project_id, id)` of the endpoint tables: the callback
        # presents `state` and nothing else, so the row must be reachable without its
        # project.
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("state", name="uq_mcps_oauth_attempts_state"),
    )
    op.create_index(
        "ix_mcps_oauth_attempts_expires_at",
        "mcps_oauth_attempts",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_mcps_oauth_attempts_expires_at",
        table_name="mcps_oauth_attempts",
    )
    op.drop_table("mcps_oauth_attempts")
