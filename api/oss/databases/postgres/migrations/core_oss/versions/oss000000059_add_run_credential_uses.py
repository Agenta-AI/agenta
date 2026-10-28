"""add run_credential_uses: which person's own account a run used, per connection

One row per run and connection when a run uses a person's own credential (M7, design
D8): the binding, the owner, the credential id and its display name at the time. No
value and no provider account detail. Read per session, so each turn can say which
account it used, also after the credential is deleted (no FK on the credential).

A new table: no lock on any existing table. The downgrade drops it.

Revision ID: oss000000059
Revises: oss000000058
Create Date: 2026-10-29 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000059"
down_revision: Union[str, None] = "oss000000058"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS run_credential_uses (
            project_id UUID NOT NULL,
            session_id VARCHAR NOT NULL,
            run_id VARCHAR NOT NULL,
            connection_key VARCHAR NOT NULL,
            binding VARCHAR NOT NULL,
            owner_kind VARCHAR NOT NULL,
            owner_id UUID NOT NULL,
            credential_id UUID NOT NULL,
            credential_name VARCHAR,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT pk_run_credential_uses
                PRIMARY KEY (project_id, run_id, connection_key),
            CONSTRAINT fk_run_credential_uses_project_id FOREIGN KEY (project_id)
                REFERENCES projects (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_run_credential_uses_session "
        "ON run_credential_uses (project_id, session_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS run_credential_uses")
