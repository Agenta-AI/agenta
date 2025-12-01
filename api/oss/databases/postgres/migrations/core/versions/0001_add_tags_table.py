"""add tags table for tag registry

Revision ID: 0001_add_tags
Revises: fd77265d65dc
Create Date: 2025-11-27 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001_add_tags"
down_revision: Union[str, None] = "fd77265d65dc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create tags table as registry of tag keys per project/kind
    op.create_table(
        'tags',
        sa.Column(
            'project_id',
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            'kind',
            sa.String(),
            nullable=False,
        ),
        sa.Column(
            'key',
            sa.String(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('project_id', 'kind', 'key'),
    )

    # Create index for fast autocomplete queries
    op.create_index(
        'ix_tags_project_id_kind',
        'tags',
        ['project_id', 'kind'],
    )


def downgrade() -> None:
    op.drop_index('ix_tags_project_id_kind', table_name='tags')
    op.drop_table('tags')
