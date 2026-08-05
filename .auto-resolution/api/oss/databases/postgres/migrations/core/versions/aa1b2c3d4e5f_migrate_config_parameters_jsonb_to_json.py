"""Migrate config_parameters from JSONB to JSON

Revision ID: aa1b2c3d4e5f
Revises: d5d4d6bf738f
Create Date: 2025-01-08 12:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "aa1b2c3d4e5f"
down_revision: Union[str, None] = "d5d4d6bf738f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    """
    Migrate config_parameters from JSONB to JSON type to preserve key ordering.
    This involves:
    1. Creating new JSON columns
    2. Copying data from JSONB to JSON
    3. Dropping old JSONB columns
    4. Renaming new columns to original names
    """

    # Step 1: Add new JSON columns with temporary names
    op.add_column(
        "app_variants",
        sa.Column("config_parameters_json_temp", sa.JSON(), nullable=True),
    )

    op.add_column(
        "app_variant_revisions",
        sa.Column("config_parameters_json_temp", sa.JSON(), nullable=True),
    )

    # Step 2: Copy data from JSONB to JSON columns
    # For app_variants table
    op.execute(
        """
        UPDATE app_variants 
        SET config_parameters_json_temp = config_parameters::json
    """
    )

    # For app_variant_revisions table
    op.execute(
        """
        UPDATE app_variant_revisions 
        SET config_parameters_json_temp = config_parameters::json
    """
    )

    # Step 3: Drop the old JSONB columns
    op.drop_column("app_variants", "config_parameters")
    op.drop_column("app_variant_revisions", "config_parameters")

    # Step 4: Rename the new JSON columns to the original names
    op.alter_column(
        "app_variants",
        "config_parameters_json_temp",
        new_column_name="config_parameters",
        nullable=False,
        server_default="{}",
    )

    op.alter_column(
        "app_variant_revisions",
        "config_parameters_json_temp",
        new_column_name="config_parameters",
        nullable=False,
    )


def downgrade():
    """
    Migrate config_parameters from JSON back to JSONB type.
    """

    # Step 1: Add new JSONB columns with temporary names
    op.add_column(
        "app_variants",
        sa.Column("config_parameters_jsonb_temp", postgresql.JSONB(), nullable=True),
    )

    op.add_column(
        "app_variant_revisions",
        sa.Column("config_parameters_jsonb_temp", postgresql.JSONB(), nullable=True),
    )

    # Step 2: Copy data from JSON to JSONB columns
    # For app_variants table
    op.execute(
        """
        UPDATE app_variants 
        SET config_parameters_jsonb_temp = config_parameters::jsonb
    """
    )

    # For app_variant_revisions table
    op.execute(
        """
        UPDATE app_variant_revisions 
        SET config_parameters_jsonb_temp = config_parameters::jsonb
    """
    )

    # Step 3: Drop the old JSON columns
    op.drop_column("app_variants", "config_parameters")
    op.drop_column("app_variant_revisions", "config_parameters")

    # Step 4: Rename the new JSONB columns to the original names
    op.alter_column(
        "app_variants",
        "config_parameters_jsonb_temp",
        new_column_name="config_parameters",
        nullable=False,
    )

    op.alter_column(
        "app_variant_revisions",
        "config_parameters_jsonb_temp",
        new_column_name="config_parameters",
        nullable=False,
    )
