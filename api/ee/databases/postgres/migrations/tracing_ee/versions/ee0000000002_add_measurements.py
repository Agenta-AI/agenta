"""add measurements and measurement_values

Gateway-owned, append-only LLM/MCP/SBX measurement facts (Wave 1 wallet design,
`docs/design/wallets-research/v1/entities.md` "measurements"/"measurement_values").
No organization/workspace column and no wallet-debit FK: the gateway and wallet
communicate only through independent Redis stream messages.

Revision ID: ee0000000002
Revises: ee0000000001
Create Date: 2026-08-14 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "ee0000000002"
down_revision: Union[str, None] = "ee0000000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "measurements",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("measurement_id", sa.VARCHAR(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("agent_id", sa.UUID(), nullable=True),
        sa.Column("gateway_kind", sa.VARCHAR(), nullable=False),
        sa.Column("request_id", sa.VARCHAR(), nullable=False),
        sa.Column("resource_key", sa.VARCHAR(), nullable=False),
        sa.Column("endpoint_id", sa.VARCHAR(), nullable=True),
        sa.Column("endpoint_kind", sa.VARCHAR(), nullable=False),
        sa.Column(
            "resource_locator",
            postgresql.JSONB(none_as_null=True),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "data",
            postgresql.JSONB(none_as_null=True),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("start_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("end_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("measurement_id", name="uq_measurements_measurement_id"),
    )
    op.create_index(
        "ix_measurements_project_id",
        "measurements",
        ["project_id"],
    )
    op.create_index(
        "ix_measurements_request_id",
        "measurements",
        ["request_id"],
    )

    op.create_table(
        "measurement_values",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("measurement_id", sa.UUID(), nullable=False),
        sa.Column("key", sa.VARCHAR(), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column("cost_musd", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["measurement_id"],
            ["measurements.id"],
            name="fk_measurement_values_measurement_id",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "measurement_id", "key", name="uq_measurement_values_measurement_id_key"
        ),
    )
    op.create_index(
        "ix_measurement_values_measurement_id",
        "measurement_values",
        ["measurement_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_measurement_values_measurement_id", table_name="measurement_values"
    )
    op.drop_table("measurement_values")
    op.drop_index("ix_measurements_request_id", table_name="measurements")
    op.drop_index("ix_measurements_project_id", table_name="measurements")
    op.drop_table("measurements")
