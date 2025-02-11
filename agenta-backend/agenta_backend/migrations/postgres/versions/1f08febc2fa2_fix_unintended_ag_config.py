"""fix 'unintended ag_config'
Revision ID: 1f08febc2fa2
Revises: 0f086ebc2f83
Create Date: 2025-01-08 10:24:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "1f08febc2fa2"
down_revision: Union[str, None] = "0f086ebc2f83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    """Apply migration: replace config_parameters with config_parameters->'ag_config'"""

    conn = op.get_bind()

    conn.execute(
        sa.text(
            """
                UPDATE app_variants
                SET config_parameters = config_parameters->'ag_config'
                WHERE config_parameters ? 'ag_config';
            """
        )
    )

    conn.execute(
        sa.text(
            """
                UPDATE app_variant_revisions
                SET config_parameters = config_parameters->'ag_config'
                WHERE config_parameters ? 'ag_config';
            """
        )
    )


def downgrade():
    """Revert migration: wrap config_parameters inside an 'ag_config' key"""

    conn = op.get_bind()

    conn.execute(
        sa.text(
            """
                UPDATE app_variants
                SET config_parameters = jsonb_build_object('ag_config', config_parameters)
                WHERE config_parameters IS NOT NULL;
            """
        )
    )

    conn.execute(
        sa.text(
            """
                UPDATE app_variant_revisions
                SET config_parameters = jsonb_build_object('ag_config', config_parameters)
                WHERE config_parameters IS NOT NULL;
            """
        )
    )
