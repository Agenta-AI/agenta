"""rename metadata to meta

Revision ID: 9698355c7650
Revises: 0698355c7642
Create Date: 2025-05-21 07:27:45.801481

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9698355c7650"
down_revision: Union[str, None] = "0698355c7642"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # - WORKFLOWS --------------------------------------------------------------

    op.execute("ALTER TABLE workflow_artifacts RENAME COLUMN metadata TO meta")
    op.execute("ALTER TABLE workflow_variants  RENAME COLUMN metadata TO meta")
    op.execute("ALTER TABLE workflow_revisions RENAME COLUMN metadata TO meta")

    # - TESTSETS ---------------------------------------------------------------

    op.execute("ALTER TABLE testset_artifacts  RENAME COLUMN metadata TO meta")
    op.execute("ALTER TABLE testset_variants   RENAME COLUMN metadata TO meta")
    op.execute("ALTER TABLE testset_revisions  RENAME COLUMN metadata TO meta")

    # --------------------------------------------------------------------------


def downgrade() -> None:
    # - WORKFLOWS --------------------------------------------------------------

    op.execute("ALTER TABLE workflow_artifacts RENAME COLUMN meta TO metadata")
    op.execute("ALTER TABLE workflow_variants  RENAME COLUMN meta TO metadata")
    op.execute("ALTER TABLE workflow_revisions RENAME COLUMN meta TO metadata")

    # - TESTSETS ---------------------------------------------------------------

    op.execute("ALTER TABLE testset_artifacts  RENAME COLUMN meta TO metadata")
    op.execute("ALTER TABLE testset_variants   RENAME COLUMN meta TO metadata")
    op.execute("ALTER TABLE testset_revisions  RENAME COLUMN meta TO metadata")

    # --------------------------------------------------------------------------
