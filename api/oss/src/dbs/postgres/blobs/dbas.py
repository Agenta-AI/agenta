from sqlalchemy import Column, UUID

from oss.src.dbs.postgres.shared.dbas import IdentifierDBA, SlugDBA, DataDBA


class BlobDBA(IdentifierDBA, SlugDBA, DataDBA):
    __abstract__ = True

    set_id = Column(
        UUID,
        nullable=True,
    )
