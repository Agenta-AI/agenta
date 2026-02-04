from typing import TypeVar, Type
from uuid import UUID

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


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

    if "data" in attributes:
        print(
            f"[DAO] map_dto_to_dbe: DBE={DBE.__name__}, data={attributes['data']}",
            flush=True,
        )

    try:
        dbe = DBE(**attributes)
    except Exception as e:
        print(
            f"[DAO] map_dto_to_dbe FAILED: DBE={DBE.__name__}, "
            f"error={type(e).__name__}: {e}, "
            f"attributes_keys={list(attributes.keys())}",
            flush=True,
        )
        raise

    return dbe


def map_dbe_to_dto(
    *,
    DTO: Type[DTO_T],
    dbe: DBE_T,
) -> DTO_T:
    """Map a SQLAlchemy DBE instance to a Pydantic DTO."""

    dbe_fields = {column.name for column in dbe.__table__.columns}
    dto_fields = set(DTO.model_fields.keys())
    common_fields = dbe_fields & dto_fields

    attributes = {
        field: getattr(dbe, field) for field in common_fields if hasattr(dbe, field)
    }

    # Create the DTO instance
    dto = DTO(**attributes)

    return dto
