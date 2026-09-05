from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.skills.dbas import SkillSourceDBA, SkillSourceLinkDBA


class SkillSourceDBE(Base, SkillSourceDBA):
    __tablename__ = "skill_sources"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "slug",
            name="uq_skill_sources_project_id_slug",
        ),
        Index(
            "ix_skill_sources_project_id_created_at",
            "project_id",
            "created_at",
        ),
    )


class SkillSourceLinkDBE(Base, SkillSourceLinkDBA):
    __tablename__ = "skill_source_links"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "source_id"],
            ["skill_sources.project_id", "skill_sources.id"],
            ondelete="CASCADE",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "source_id",
            "path_in_repo",
            name="uq_skill_source_links_source_path",
        ),
        Index(
            "ix_skill_source_links_project_id_workflow_id",
            "project_id",
            "workflow_id",
        ),
    )
