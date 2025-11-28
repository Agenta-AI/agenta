from sqlalchemy import (
    Column,
    ForeignKey,
    UniqueConstraint,
    Index,
    Enum as SAEnum,
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
        UniqueConstraint(
            "project_id",
            "parent_id",
            "slug",
            name="uq_folders_project_parent_slug",
        ),
        Index(
            "ix_folders_project_kind_path",
            "project_id",
            "kind",
            "path",
            postgresql_using="gist",
        ),
    )

    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="CASCADE"),
        nullable=True,
    )

    path = Column(
        LtreeType(),
        nullable=False,
    )

    kind = Column(
        SAEnum(FolderKind, name="folder_kind_enum"),
        nullable=False,
    )
