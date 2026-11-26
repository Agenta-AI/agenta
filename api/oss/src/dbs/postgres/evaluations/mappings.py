from typing import TypeVar, Type
from uuid import UUID

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


DBE_T = TypeVar("DBE_T")  # pylint: disable=invalid-name
DTO_T = TypeVar("DTO_T")  # pylint: disable=invalid-name


def create_dbe_from_dto(
    *,
    DBE: Type[DBE_T],
    project_id: UUID,
    dto: DTO_T,
    **kwargs,
) -> DBE_T:
    """Map a Pydantic DTO instance to a SQLAlchemy DBE, with extra project_id."""

    attributes = dto.model_dump(
        # mode="json",
        exclude_none=True,
    )
    # A read-only field, never a column; the principal is written by its own setter.
    attributes.pop("principal", None)
    attributes["project_id"] = project_id

    dbe = DBE(**attributes, **kwargs)

    return dbe


def edit_dbe_from_dto(
    *,
    dbe: DBE_T,
    dto: DTO_T,
    **kwargs,
) -> DBE_T:
    """Edit a SQLAlchemy DBE instance with a Pydantic DTO."""

    for field, value in dto.model_dump(
        # mode="json",
        exclude_none=True,
    ).items():
        if field == "principal":  # read-only; never set by an edit
            continue
        setattr(dbe, field, value)

    for field, value in kwargs.items():
        if hasattr(dbe, field):
            setattr(dbe, field, value)

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

    # The run principal is two columns on the row and one field on the read DTO.
    if "principal" in dto_fields and "principal_kind" in dbe_fields:
        from oss.src.dbs.postgres.access.mappings import (  # noqa: PLC0415
            map_principal_columns,
        )

        attributes["principal"] = map_principal_columns(
            kind=dbe.principal_kind, id=dbe.principal_id
        )

    if attributes.get("trace_id") is not None:
        attributes["trace_id"] = str(attributes["trace_id"])

    dto = DTO(**attributes)

    return dto
