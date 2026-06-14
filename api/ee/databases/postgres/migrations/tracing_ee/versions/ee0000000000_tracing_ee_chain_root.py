"""root of the post-alignment EE-only tracing chain

Runs only in EE, tracked in alembic_version_tracing_ee, after the shared (oss)
tracing chain. EE-only tracing schema (and any adoption create-if-missing logic
for OSS-to-EE switches) lives here from now on. Mirrors the core EE-only chain
root (`ee0000000000`).

Revision ID: ee0000000000
Revises:
Create Date: 2026-06-14 00:00:03.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "ee0000000000"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
