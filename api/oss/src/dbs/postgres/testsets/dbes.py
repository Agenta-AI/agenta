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


class TestsetArtifactDBE(Base, ProjectScopeDBA, ArtifactDBA):
    __tablename__ = "testset_artifacts"

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
        Index(
            "ix_testset_artifacts_project_id_slug",
            "project_id",
            "slug",
        ),
    )


class TestsetVariantDBE(Base, ProjectScopeDBA, VariantDBA):
    __tablename__ = "testset_variants"

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
            ["testset_artifacts.project_id", "testset_artifacts.id"],
            ondelete="CASCADE",
        ),
        Index(
            "ix_testset_variants_project_id_slug",
            "project_id",
            "slug",
        ),
        Index(
            "ix_testset_variants_project_id_artifact_id",
            "project_id",
            "artifact_id",
        ),
    )

    artifact = relationship(
        "TestsetArtifactDBE",
        backref="testset_variants",
        cascade=CASCADE_ALL_DELETE,
        passive_deletes=True,
        single_parent=True,
    )


class TestsetRevisionDBE(Base, ProjectScopeDBA, RevisionDBA):
    __tablename__ = "testset_revisions"

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
            ["testset_artifacts.project_id", "testset_artifacts.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "variant_id"],
            ["testset_variants.project_id", "testset_variants.id"],
            ondelete="CASCADE",
        ),
        Index(
            "ix_testset_revisions_project_id_slug",
            "project_id",
            "slug",
        ),
        Index(
            "ix_testset_revisions_project_id_artifact_id",
            "project_id",
            "artifact_id",
        ),
        Index(
            "ix_testset_revisions_project_id_variant_id",
            "project_id",
            "variant_id",
        ),
    )

    artifact = relationship(
        "TestsetArtifactDBE",
        viewonly=True,
    )
    variant = relationship(
        "TestsetVariantDBE",
        viewonly=True,
    )
