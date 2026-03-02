from sqlalchemy import Column, UUID

from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    SlugDBA,
    VersionDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    HeaderDBA,
    CommitDBA,
    DataDBA,
    FolderScopeDBA,
)


class ArtifactDBA(
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    HeaderDBA,
    FolderScopeDBA,
):
    __abstract__ = True


class VariantDBA(
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    HeaderDBA,
):
    __abstract__ = True

    artifact_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class RevisionDBA(
    IdentifierDBA,
    SlugDBA,
    VersionDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    HeaderDBA,
    CommitDBA,
    DataDBA,
):
    __abstract__ = True

    artifact_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )

    variant_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
