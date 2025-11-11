from sqlalchemy import (
    ForeignKeyConstraint,
    PrimaryKeyConstraint,
    Index,
    UniqueConstraint,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import ProjectScopeDBA
from oss.src.dbs.postgres.blobs.dbas import BlobDBA


class TestcaseBlobDBE(Base, ProjectScopeDBA, BlobDBA):
    __tablename__ = "testcase_blobs"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        UniqueConstraint(
            "project_id",
            "slug",
        ),
        UniqueConstraint(
            "project_id",
            "set_id",
            "id",
        ),
        UniqueConstraint(
            "project_id",
            "set_id",
            "slug",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "set_id"],
            ["testset_artifacts.project_id", "testset_artifacts.id"],
            ondelete="CASCADE",
        ),
        Index(
            "ix_testcase_blobs_project_id_blob_slug",
            "project_id",
            "slug",
        ),
        Index(
            "ix_testcase_blobs_project_id_set_id",
            "project_id",
            "set_id",
        ),
        Index(
            "ix_testcase_blobs_project_id_set_id_id",
            "project_id",
            "set_id",
            "id",
        ),
        Index(
            "ix_testcase_blobs_project_id_set_id_slug",
            "project_id",
            "set_id",
            "slug",
        ),
    )
