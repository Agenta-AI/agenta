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


class QueryArtifactDBE(Base, ProjectScopeDBA, ArtifactDBA):
    __tablename__ = "query_artifacts"

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
            "ix_query_artifacts_project_id_slug",
            "project_id",
            "slug",
        ),
    )


class QueryVariantDBE(Base, ProjectScopeDBA, VariantDBA):
    __tablename__ = "query_variants"

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
            ["query_artifacts.project_id", "query_artifacts.id"],
            ondelete="CASCADE",
        ),
        Index(
            "ix_query_variants_project_id_slug",
            "project_id",
            "slug",
        ),
        Index(
            "ix_query_variants_project_id_artifact_id",
            "project_id",
            "artifact_id",
        ),
    )

    artifact = relationship(
        "QueryArtifactDBE",
        backref="query_variants",
        cascade=CASCADE_ALL_DELETE,
        passive_deletes=True,
        single_parent=True,
    )


class QueryRevisionDBE(Base, ProjectScopeDBA, RevisionDBA):
    __tablename__ = "query_revisions"

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
            ["query_artifacts.project_id", "query_artifacts.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "variant_id"],
            ["query_variants.project_id", "query_variants.id"],
            ondelete="CASCADE",
        ),
        Index(
            "ix_query_revisions_project_id_slug",
            "project_id",
            "slug",
        ),
        Index(
            "ix_query_revisions_project_id_artifact_id",
            "project_id",
            "artifact_id",
        ),
        Index(
            "ix_query_revisions_project_id_variant_id",
            "project_id",
            "variant_id",
        ),
    )

    artifact = relationship(
        "QueryArtifactDBE",
        viewonly=True,
    )
    variant = relationship(
        "QueryVariantDBE",
        viewonly=True,
    )
