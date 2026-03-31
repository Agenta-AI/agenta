from sqlalchemy.orm import relationship
from sqlalchemy import (
    ForeignKeyConstraint,
    PrimaryKeyConstraint,
    Index,
    UniqueConstraint,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import ProjectScopeDBA
from oss.src.dbs.postgres.git.dbas import VariantDBA, RevisionDBA, ArtifactDBA


CASCADE_ALL_DELETE = "all, delete-orphan"


class EnvironmentArtifactDBE(Base, ProjectScopeDBA, ArtifactDBA):
    __tablename__ = "environment_artifacts"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        UniqueConstraint(
            "project_id",
            "slug",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["folder_id"],
            ["folders.id"],
            ondelete="SET NULL",
        ),
        Index(
            "ix_environment_artifacts_project_id_slug",
            "project_id",
            "slug",
        ),
        Index(
            "ix_environment_artifacts_folder_id",
            "folder_id",
        ),
    )


class EnvironmentVariantDBE(Base, ProjectScopeDBA, VariantDBA):
    __tablename__ = "environment_variants"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        UniqueConstraint(
            "project_id",
            "slug",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "artifact_id"],
            ["environment_artifacts.project_id", "environment_artifacts.id"],
            ondelete="CASCADE",
        ),
        Index(
            "ix_environment_variants_project_id_slug",
            "project_id",
            "slug",
        ),
        Index(
            "ix_environment_variants_project_id_artifact_id",
            "project_id",
            "artifact_id",
        ),
    )

    artifact = relationship(
        "EnvironmentArtifactDBE",
        backref="environment_variants",
        cascade=CASCADE_ALL_DELETE,
        passive_deletes=True,
        single_parent=True,
    )


class EnvironmentRevisionDBE(Base, ProjectScopeDBA, RevisionDBA):
    __tablename__ = "environment_revisions"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        UniqueConstraint(
            "project_id",
            "slug",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "artifact_id"],
            ["environment_artifacts.project_id", "environment_artifacts.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "variant_id"],
            ["environment_variants.project_id", "environment_variants.id"],
            ondelete="CASCADE",
        ),
        Index(
            "ix_environment_revisions_project_id_slug",
            "project_id",
            "slug",
        ),
        Index(
            "ix_environment_revisions_project_id_artifact_id",
            "project_id",
            "artifact_id",
        ),
        Index(
            "ix_environment_revisions_project_id_variant_id",
            "project_id",
            "variant_id",
        ),
    )

    artifact = relationship(
        "EnvironmentArtifactDBE",
        viewonly=True,
    )
    variant = relationship(
        "EnvironmentVariantDBE",
        viewonly=True,
    )
