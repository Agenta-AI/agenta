from typing import Optional, Dict, List, Union, Literal
from uuid import UUID
from datetime import datetime
from re import match

from pydantic import BaseModel, field_validator

from typing_extensions import TypeAliasType


BoolJson: TypeAliasType = TypeAliasType(  # type: ignore
    "BoolJson",
    Union[bool, Dict[str, "BoolJson"]],  # type: ignore
)

StringJson: TypeAliasType = TypeAliasType(  # type: ignore
    "StringJson",
    Union[str, Dict[str, "StringJson"]],  # type: ignore
)

FullJson: TypeAliasType = TypeAliasType(  # type: ignore
    "FullJson",
    Union[str, int, float, bool, None, Dict[str, "FullJson"], List["FullJson"]],  # type: ignore
)

NumericJson: TypeAliasType = TypeAliasType(  # type: ignore
    "NumericJson",
    Union[int, float, Dict[str, "NumericJson"]],  # type: ignore
)

NoListJson: TypeAliasType = TypeAliasType(  # type: ignore
    "NoListJson",
    Union[str, int, float, bool, None, Dict[str, "NoListJson"]],  # type: ignore
)

Json = Dict[str, FullJson]  # type: ignore

Data = Dict[str, FullJson]  # type: ignore

Flags = Dict[str, bool | str]  # type: ignore

Tags = Dict[str, NoListJson]  # type: ignore

Meta = Dict[str, FullJson]  # type: ignore

Hashes = Dict[str, StringJson]  # type: ignore


class Metadata(BaseModel):
    flags: Optional[Flags] = None
    meta: Optional[Meta] = None
    tags: Optional[Tags] = None


class Windowing(BaseModel):
    # RANGE
    newest: Optional[datetime] = None
    oldest: Optional[datetime] = None
    # TOKEN
    next: Optional[UUID] = None
    # LIMIT
    limit: Optional[int] = None
    # ORDER
    order: Optional[Literal["ascending", "descending"]] = None
    # BUCKETS
    interval: Optional[int] = None
    # SAMPLES
    rate: Optional[float] = None

    @field_validator("rate")
    def check_rate(cls, v):
        if v is not None and (v < 0.0 or v > 1.0):
            raise ValueError("Sampling rate must be between 0.0 and 1.0.")
        return v

    @field_validator("interval")
    def check_interval(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Bucket interval must be a positive integer.")
        return v


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
    def check_url_safety(cls, v):
        if v is not None:
            if not match(r"^[a-zA-Z0-9_-]+$", v):
                raise ValueError("slug must be URL-safe.")
        return v


class Version(BaseModel):
    version: Optional[str] = None


class Reference(Identifier, Slug, Version):
    pass


class Link(TraceID, SpanID):
    pass


class Header(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class Commit(BaseModel):
    author: Optional[UUID] = None
    date: Optional[datetime] = None
    message: Optional[str] = None


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


Metrics = Dict[str, NumericJson]  # type: ignore


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    # DEPRECATING
    updated_by: Optional[str] = None  # email


# WORKFLOWS --------------------------------------------------------------------


class Status(BaseModel):
    code: Optional[int] = 500
    type: Optional[str] = None
    message: Optional[str] = "An unexpected error occurred. Please try again later."
    stacktrace: Optional[str] = None


Mappings = Dict[str, str]

Schema = Dict[str, FullJson]  # type: ignore
