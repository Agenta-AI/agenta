from typing import Optional, Dict, List, Union, Literal
from uuid import UUID
from datetime import datetime
from re import match

from pydantic import BaseModel, field_validator

from typing_extensions import TypeAliasType


BoolJson: TypeAliasType = TypeAliasType(
    "BoolJson",
    Union[bool, Dict[str, "BoolJson"]],
)

StringJson: TypeAliasType = TypeAliasType(
    "StringJson",
    Union[str, Dict[str, "StringJson"]],
)

FullJson: TypeAliasType = TypeAliasType(
    "FullJson",
    Union[str, int, float, bool, None, Dict[str, "FullJson"], List["FullJson"]],
)

NumericJson: TypeAliasType = TypeAliasType(
    "NumericJson",
    Union[int, float, Dict[str, "NumericJson"]],
)

NoListJson: TypeAliasType = TypeAliasType(
    "NoListJson",
    Union[str, int, float, bool, None, Dict[str, "NoListJson"]],
)

Json = Dict[str, FullJson]

Data = Dict[str, FullJson]

Meta = Dict[str, FullJson]

Tags = Dict[str, NoListJson]

Flags = Dict[str, bool]

Hashes = Dict[str, StringJson]


class Metadata(BaseModel):
    flags: Optional[Flags] = None
    meta: Optional[Meta] = None
    tags: Optional[Tags] = None


class Windowing(BaseModel):
    next: Optional[UUID] = None
    start: Optional[datetime] = None
    stop: Optional[datetime] = None
    limit: Optional[int] = None
    order: Optional[Literal["ascending", "descending"]] = None


class Lifecycle(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    created_by_id: Optional[UUID] = None
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None


class TraceID(BaseModel):
    trace_id: Optional[str] = None


class SpanID(BaseModel):
    span_id: Optional[str] = None


class Identifier(BaseModel):
    id: Optional[UUID] = None


class Slug(BaseModel):
    slug: Optional[str] = None

    @field_validator("slug")
    def check_url_safety(cls, v):  # pylint: disable=no-self-argument
        if v is not None:
            if not match(r"^[a-zA-Z0-9_-]+$", v):
                raise ValueError("slug must be URL-safe.")
        return v


class Version(BaseModel):
    version: Optional[str] = None


class Header(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class Reference(Identifier, Slug, Version):
    pass


class Link(TraceID, SpanID):
    pass


def sync_alias(primary: str, alias: str, instance: BaseModel) -> None:
    primary_val = getattr(instance, primary)
    alias_val = getattr(instance, alias)
    if primary_val and alias_val is None:
        object.__setattr__(instance, alias, primary_val)
    elif alias_val and primary_val is None:
        object.__setattr__(instance, primary, alias_val)


class AliasConfig(BaseModel):
    model_config = {
        "populate_by_name": True,
        "from_attributes": True,
    }


# LEGACY -----------------------------------------------------------------------


Metrics = Dict[str, NumericJson]


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    # DEPRECATING
    updated_by: Optional[str] = None  # email
