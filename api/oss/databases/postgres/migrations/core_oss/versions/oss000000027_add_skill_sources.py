"""add skill sources and links

Provenance for imported skills (WP-A5). `skill_sources` is one imported
repo/marketplace per row; `skill_source_links` ties each imported skill's
workflow to its path in that source. `workflow_id` is a bare column, not an
FK — archiving a workflow must not erase provenance history. `detached` is
the queryable local-edit-breaks-sync state (commit meta is JSON, not JSONB,
so it cannot carry queryable provenance).

Revision ID: oss000000027
Revises: oss000000026
Create Date: 2026-09-06 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "oss000000027"
down_revision: Union[str, None] = "oss000000026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _lifecycle_columns() -> list:
    return [
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        "skill_sources",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("repo_url", sa.String(), nullable=False),
        sa.Column("ref", sa.String(), nullable=True),
        sa.Column("last_seen_commit_sha", sa.String(), nullable=True),
        sa.Column(
            "sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        *_lifecycle_columns(),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id", "slug", name="uq_skill_sources_project_id_slug"
        ),
    )
    op.create_index(
        "ix_skill_sources_project_id_created_at",
        "skill_sources",
        ["project_id", "created_at"],
    )

    op.create_table(
        "skill_source_links",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source_id", sa.UUID(), nullable=False),
        sa.Column("workflow_id", sa.UUID(), nullable=False),
        sa.Column("path_in_repo", sa.String(), nullable=False),
        sa.Column("imported_commit_sha", sa.String(), nullable=True),
        sa.Column("content_hash", sa.String(), nullable=True),
        sa.Column(
            "detached", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "missing_in_source",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        *_lifecycle_columns(),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["project_id", "source_id"],
            ["skill_sources.project_id", "skill_sources.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "source_id",
            "path_in_repo",
            name="uq_skill_source_links_source_path",
        ),
    )
    op.create_index(
        "ix_skill_source_links_project_id_workflow_id",
        "skill_source_links",
        ["project_id", "workflow_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_skill_source_links_project_id_workflow_id",
        table_name="skill_source_links",
    )
    op.drop_table("skill_source_links")
    op.drop_index(
        "ix_skill_sources_project_id_created_at",
        table_name="skill_sources",
    )
    op.drop_table("skill_sources")
