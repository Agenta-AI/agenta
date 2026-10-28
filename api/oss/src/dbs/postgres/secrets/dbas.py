import uuid_utils.compat as uuid
from sqlalchemy import Column, Enum as SQLEnum, String, UUID

from oss.src.core.secrets.enums import SecretKind
from oss.src.dbs.postgres.shared.dbas import (
    LifecycleDBA,
    HeaderDBA,
)
from oss.src.dbs.postgres.secrets.custom_fields import PGPString


class SecretsDBA(LifecycleDBA, HeaderDBA):
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    slug = Column(String, nullable=True)
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
    # A personal credential (M7): `organization_id` and `user_id` set, no project.
    user_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
    # Read only for organization rows (M5): `all_projects` or `selected_projects`, the
    # latter with the projects listed in `secret_projects`. Project rows keep the default.
    availability = Column(
        String,
        nullable=False,
        server_default="all_projects",
    )
