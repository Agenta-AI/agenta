import uuid_utils.compat as uuid
from sqlalchemy import Column, Enum as SQLEnum, UUID

from oss.src.core.secrets.enums import SecretKind
from oss.src.dbs.postgres.shared.dbas import (
    LegacyLifecycleDBA,
    HeaderDBA,
)
from oss.src.dbs.postgres.secrets.custom_fields import PGPString


class SecretsDBA(LegacyLifecycleDBA, HeaderDBA):
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
    project_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
    organization_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
