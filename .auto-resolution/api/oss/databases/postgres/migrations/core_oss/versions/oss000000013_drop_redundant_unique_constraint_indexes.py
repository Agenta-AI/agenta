"""drop indexes redundant with an identical unique constraint

Postgres backs every UNIQUE constraint with its own implicit b-tree index,
so an explicit Index() on the exact same column tuple/order is dead weight
(extra write cost + storage, no read benefit). Drops the redundant explicit
indexes across the git-artifact/variant/revision tables (project_id, slug)
and the two session tables + folders (project_id, session_id / path).

Revision ID: oss000000013
Revises: oss000000012
Create Date: 2026-07-13 00:00:01.000000

"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000013"
down_revision: Union[str, None] = "oss000000012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (index_name, table_name, [columns...]) — columns/order match the surviving
# UniqueConstraint exactly, so downgrade recreates a byte-identical index.
_REDUNDANT_INDEXES = [
    (
        "ix_environment_artifacts_project_id_slug",
        "environment_artifacts",
        ["project_id", "slug"],
    ),
    (
        "ix_environment_variants_project_id_slug",
        "environment_variants",
        ["project_id", "slug"],
    ),
    (
        "ix_environment_revisions_project_id_slug",
        "environment_revisions",
        ["project_id", "slug"],
    ),
    (
        "ix_workflow_artifacts_project_id_slug",
        "workflow_artifacts",
        ["project_id", "slug"],
    ),
    (
        "ix_workflow_variants_project_id_slug",
        "workflow_variants",
        ["project_id", "slug"],
    ),
    (
        "ix_workflow_revisions_project_id_slug",
        "workflow_revisions",
        ["project_id", "slug"],
    ),
    (
        "ix_testset_artifacts_project_id_slug",
        "testset_artifacts",
        ["project_id", "slug"],
    ),
    ("ix_testset_variants_project_id_slug", "testset_variants", ["project_id", "slug"]),
    (
        "ix_testset_revisions_project_id_slug",
        "testset_revisions",
        ["project_id", "slug"],
    ),
    ("ix_query_artifacts_project_id_slug", "query_artifacts", ["project_id", "slug"]),
    ("ix_query_variants_project_id_slug", "query_variants", ["project_id", "slug"]),
    ("ix_query_revisions_project_id_slug", "query_revisions", ["project_id", "slug"]),
    (
        "ix_session_states_project_id_session_id",
        "session_states",
        ["project_id", "session_id"],
    ),
    (
        "ix_session_streams_project_id_session_id",
        "session_streams",
        ["project_id", "session_id"],
    ),
    ("ix_folders_project_path", "folders", ["project_id", "path"]),
]


def upgrade() -> None:
    for index_name, table_name, _columns in _REDUNDANT_INDEXES:
        op.drop_index(index_name, table_name=table_name, if_exists=True)


def downgrade() -> None:
    for index_name, table_name, columns in _REDUNDANT_INDEXES:
        op.create_index(index_name, table_name, columns, unique=False)
