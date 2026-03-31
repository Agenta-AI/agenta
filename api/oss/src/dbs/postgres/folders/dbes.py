from sqlalchemy import (
    Column,
    UniqueConstraint,
    Index,
    Enum,
    PrimaryKeyConstraint,
    ForeignKeyConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy_utils import LtreeType

from oss.src.core.folders.types import FolderKind
from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import (
    ProjectScopeDBA,
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    TagsDBA,
    FlagsDBA,
    MetaDBA,
    HeaderDBA,
)


class FolderDBE(
    Base,
    ProjectScopeDBA,
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    TagsDBA,
    FlagsDBA,
    MetaDBA,
    HeaderDBA,
):
    __tablename__ = "folders"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "parent_id"],
            ["folders.project_id", "folders.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "id",
            name="uq_folders_id",
        ),
        UniqueConstraint(
            "project_id",
            "slug",
            name="uq_folders_project_slug",
        ),
        UniqueConstraint(
            "project_id",
            "path",
            name="uq_folders_project_path",
        ),
        Index(
            "ix_folders_project_kind",
            "project_id",
            "kind",
            postgresql_using="btree",
        ),
        Index(
            "ix_folders_project_path",
            "project_id",
            "path",
            postgresql_using="btree",
        ),
    )

    parent_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )

    path = Column(
        LtreeType(),
        nullable=False,
    )

    kind = Column(
        Enum(FolderKind, name="folder_kind_enum"),
        nullable=True,
    )
