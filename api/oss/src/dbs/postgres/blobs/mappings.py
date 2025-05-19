from typing import TypeVar, Type
from uuid import UUID


DBE_T = TypeVar("DBE_T")  # pylint: disable=invalid-name
DTO_T = TypeVar("DTO_T")  # pylint: disable=invalid-name


def map_dto_to_dbe(
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


def map_dbe_to_dto(
    *,
    DTO: Type[DTO_T],
    dbe: DBE_T,
) -> DTO_T:
    """Map a SQLAlchemy DBE instance to a Pydantic DTO."""

    dbe_fields = {column.name for column in dbe.__table__.columns}
    dto_fields = set(DTO.model_fields.keys())

    # Map common fields between DBE and DTO
    common_fields = dbe_fields & dto_fields
    attributes = {
        field: getattr(dbe, field) for field in common_fields if hasattr(dbe, field)
    }

    # Create the DTO instance
    dto = DTO(**attributes)

    return dto
