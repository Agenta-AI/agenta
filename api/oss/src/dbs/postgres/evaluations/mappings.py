from typing import TypeVar, Type, Optional
from uuid import UUID
from datetime import datetime

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


DBE_T = TypeVar("DBE_T")  # pylint: disable=invalid-name
DTO_T = TypeVar("DTO_T")  # pylint: disable=invalid-name


def create_dbe_from_dto(
    *,
    DBE: Type[DBE_T],
    project_id: UUID,
    dto: DTO_T,
) -> DBE_T:
    """Map a Pydantic DTO instance to a SQLAlchemy DBE, with extra project_id."""

    attributes = dto.model_dump(exclude_none=True)
    attributes["project_id"] = project_id

    dbe = DBE(**attributes)

    return dbe


def edit_dbe_from_dto(
    *,
    dbe: DBE_T,
    dto: DTO_T,
    timestamp: Optional[datetime] = None,
    updated_at: Optional[datetime] = None,
    deleted_at: Optional[datetime] = None,
    updated_by_id: Optional[UUID] = None,
    deleted_by_id: Optional[UUID] = None,
) -> DBE_T:
    """Edit a SQLAlchemy DBE instance with a Pydantic DTO."""

    for field, value in dto.model_dump().items():
        setattr(dbe, field, value)

    if timestamp is not None:
        dbe.timestamp = timestamp
    dbe.updated_at = updated_at
    dbe.deleted_at = deleted_at
    dbe.updated_by_id = updated_by_id
    dbe.deleted_by_id = deleted_by_id

    return dbe


def create_dto_from_dbe(
    *,
    DTO: Type[DTO_T],
    dbe: DBE_T,
) -> DTO_T:
    """Map a SQLAlchemy DBE instance to a Pydantic DTO."""

    dbe_fields = {column.name for column in dbe.__table__.columns}
    dto_fields = set(DTO.model_fields.keys())

    attributes = {field: getattr(dbe, field) for field in dbe_fields & dto_fields}

    if attributes.get("trace_id") is not None:
        attributes["trace_id"] = str(attributes["trace_id"])

    dto = DTO(**attributes)

    return dto
