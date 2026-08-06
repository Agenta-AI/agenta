"""root of the post-alignment EE-only chain

Runs only in EE, tracked in alembic_version_ee, after the shared (oss) chain.
EE-only schema (and its adoption create-if-missing logic for OSS-to-EE
switches) lives here from now on; migrations in this chain may reference only
EE tables and forever-stable shared PKs.

Revision ID: ee0000000000
Revises:
Create Date: 2026-06-12 00:00:08.000000

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
