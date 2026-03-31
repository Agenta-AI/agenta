"""Fix ag_config

Revision ID: 91d3b4a8c27f
Revises: 7990f1e12f47
Create Date: 2025-04-24 11:00:00
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = "91d3b4a8c27f"
down_revision: Union[str, None] = "7990f1e12f47"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    batch_size = 100

    conn = op.get_bind()

    while True:
        # Update config_parameters in app_variant_revisions table
        result = conn.execute(
            text(
                f"""
                WITH updated AS (
                    UPDATE app_variant_revisions
                    SET config_parameters = config_parameters->'ag_config'
                    WHERE id IN (
                        SELECT id
                        FROM app_variant_revisions
                        WHERE config_parameters ? 'ag_config'
                        LIMIT {batch_size}
                    )
                    RETURNING id
                )
                SELECT COUNT(*) FROM updated;
                """
            )
        )
        count = result.scalar()
        if count == 0:
            break

    # Clear the config_parameters column in app_variants table (execute once)
    result = conn.execute(
        text(
            """
            UPDATE app_variants
            SET config_parameters = '{}'::jsonb
            """
        )
    )


def downgrade():
    pass
