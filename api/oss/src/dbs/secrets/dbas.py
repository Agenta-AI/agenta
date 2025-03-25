import uuid_utils.compat as uuid
from sqlalchemy import Column, Enum as SQLEnum, UUID

from oss.src.core.secrets.enums import SecretKind
from oss.src.dbs.postgres.shared.dbas import (
    ProjectScopeDBA,
    LifecycleDBA,
    HeaderDBA,
)
from oss.src.dbs.secrets.custom_fields import PGPString


class SecretsDBA(ProjectScopeDBA, LifecycleDBA, HeaderDBA):
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    kind = Column(SQLEnum(SecretKind, name="secretkind_enum"))  # type: ignore
    data = Column(PGPString())  # type: ignore
