from sqlalchemy import Column, UUID

from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    DataDBA,
)


class BlobDBA(
    IdentifierDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    DataDBA,
):
    __abstract__ = True

    set_id = Column(
        UUID,
        nullable=True,
    )
