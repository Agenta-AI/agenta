"""clean up preview entities

Revision ID: 8089ee7692d1
Revises: fa07e07350bf
Create Date: 2025-08-20 16:00:00.00000000

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "8089ee7692d1"
down_revision: Union[str, None] = "fa07e07350bf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLES_WITH_DATA_MIGRATION = [
    "evaluation_runs",
    "evaluation_metrics",
    "evaluation_queues",
    "testcase_blobs",
    "testset_revisions",
    "query_revisions",
    "workflow_revisions",
]

TABLES_WITH_META_MIGRATION = [
    "evaluation_runs",
    "evaluation_scenarios",
    "evaluation_steps",
    "evaluation_metrics",
    "evaluation_queues",
    "testcase_blobs",
    "testset_artifacts",
    "testset_variants",
    "testset_revisions",
    "query_artifacts",
    "query_variants",
    "query_revisions",
    "workflow_artifacts",
    "workflow_variants",
    "workflow_revisions",
]


def upgrade() -> None:
    # Convert jsonb -> json for data columns
    for table in TABLES_WITH_DATA_MIGRATION:
        op.alter_column(
            table_name=table,
            column_name="data",
            type_=sa.JSON(),
            postgresql_using="data::json",
        )

    # Convert jsonb -> json for meta columns
    for table in TABLES_WITH_META_MIGRATION:
        op.alter_column(
            table_name=table,
            column_name="meta",
            type_=sa.JSON(),
            postgresql_using="meta::json",
        )

    # Add new timestamp column
    op.add_column(
        "evaluation_scenarios",
        sa.Column(
            "timestamp",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )

    # Add repeat_idx and drop old repeat_id + retry_id
    op.add_column(
        "evaluation_steps",
        sa.Column(
            "repeat_idx",
            sa.Integer(),
            nullable=True,
        ),
    )
    op.drop_column(
        "evaluation_steps",
        "repeat_id",
    )
    op.drop_column(
        "evaluation_steps",
        "retry_id",
    )

    # Rename key -> step_key
    op.alter_column(
        "evaluation_steps",
        "key",
        new_column_name="step_key",
        existing_type=sa.String(),  # adjust if needed
        existing_nullable=False,
    )

    op.drop_column(
        "evaluation_metrics",
        "interval",
    )


def downgrade() -> None:
    op.add_column(
        "evaluation_metrics",
        sa.Column(
            "interval",
            sa.Integer(),
            nullable=True,
        ),
    )

    # Rename step_key back to key
    op.alter_column(
        "evaluation_steps",
        "step_key",
        new_column_name="key",
        existing_type=sa.String(),  # adjust if needed
        existing_nullable=False,
    )

    # Recreate repeat_id and retry_id columns
    op.add_column(
        "evaluation_steps",
        sa.Column("repeat_id", sa.UUID(), nullable=False),
    )
    op.add_column(
        "evaluation_steps",
        sa.Column("retry_id", sa.UUID(), nullable=False),
    )

    # Drop repeat_idx column
    op.drop_column(
        "evaluation_steps",
        "repeat_idx",
    )

    # Drop timestamp column
    op.drop_column(
        "evaluation_scenarios",
        "timestamp",
    )

    # Convert meta columns back to jsonb
    for table in TABLES_WITH_META_MIGRATION:
        op.alter_column(
            table_name=table,
            column_name="meta",
            type_=sa.dialects.postgresql.JSONB(),
            postgresql_using="meta::jsonb",
        )

    # Convert data columns back to jsonb
    for table in TABLES_WITH_DATA_MIGRATION:
        op.alter_column(
            table_name=table,
            column_name="data",
            type_=sa.dialects.postgresql.JSONB(),
            postgresql_using="data::jsonb",
        )
