"""add webhooks tables

Revision ID: e1f2g3h4i5j6
Revises: 80910d2fa9a4
Create Date: 2026-01-06 12:43:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e1f2g3h4i5j6"
down_revision: Union[str, None] = "80910d2fa9a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create webhooks table
    op.create_table(
        "webhooks",
        sa.Column(
            "id",
            postgresql.UUID(),
            nullable=False,
        ),
        sa.Column(
            "app_id",
            postgresql.UUID(),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=True, server_default="true"),
        sa.Column("webhook_type", sa.String(), nullable=False, server_default="python_script"),
        sa.Column("webhook_url", sa.String(), nullable=True),
        sa.Column("webhook_method", sa.String(), nullable=True, server_default="POST"),
        sa.Column("webhook_headers", postgresql.JSONB(), nullable=True),
        sa.Column("webhook_body_template", sa.Text(), nullable=True),
        sa.Column("script_content", sa.Text(), nullable=True),
        sa.Column("script_timeout", sa.Integer(), nullable=True, server_default="300"),
        sa.Column("docker_image", sa.String(), nullable=True, server_default="python:3.11-slim"),
        sa.Column("environment_variables", postgresql.JSONB(), nullable=True),
        sa.Column("retry_on_failure", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("max_retries", sa.Integer(), nullable=True, server_default="3"),
        sa.Column("retry_delay_seconds", sa.Integer(), nullable=True, server_default="60"),
        sa.Column("trigger_on_environments", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["app_id"],
            ["app_db.id"],
            name=op.f("fk_webhooks_app_id_app_db"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_webhooks_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_webhooks")),
    )

    # Create webhook_executions table
    op.create_table(
        "webhook_executions",
        sa.Column(
            "id",
            postgresql.UUID(),
            nullable=False,
        ),
        sa.Column(
            "webhook_id",
            postgresql.UUID(),
            nullable=False,
        ),
        sa.Column(
            "deployment_id",
            postgresql.UUID(),
            nullable=True,
        ),
        sa.Column("environment_name", sa.String(), nullable=True),
        sa.Column(
            "variant_id",
            postgresql.UUID(),
            nullable=True,
        ),
        sa.Column(
            "variant_revision_id",
            postgresql.UUID(),
            nullable=True,
        ),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("output", sa.Text(), nullable=True),
        sa.Column("error_output", sa.Text(), nullable=True),
        sa.Column("container_id", sa.String(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("is_retry", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column(
            "parent_execution_id",
            postgresql.UUID(),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["webhook_id"],
            ["webhooks.id"],
            name=op.f("fk_webhook_executions_webhook_id_webhooks"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["deployment_id"],
            ["deployments.id"],
            name=op.f("fk_webhook_executions_deployment_id_deployments"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["variant_id"],
            ["app_variants.id"],
            name=op.f("fk_webhook_executions_variant_id_app_variants"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["variant_revision_id"],
            ["app_variant_revisions.id"],
            name=op.f("fk_webhook_executions_variant_revision_id_app_variant_revisions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["parent_execution_id"],
            ["webhook_executions.id"],
            name=op.f("fk_webhook_executions_parent_execution_id_webhook_executions"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_webhook_executions")),
    )


def downgrade() -> None:
    op.drop_table("webhook_executions")
    op.drop_table("webhooks")
