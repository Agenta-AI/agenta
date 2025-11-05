from typing import Optional, Dict, List, Union, Literal
from typing_extensions import TypeAliasType
from datetime import datetime
from uuid import UUID
from re import match

from pydantic import BaseModel, field_validator

BoolJson = TypeAliasType(  # type: ignore
    "BoolJson",
    Union[bool, Dict[str, "BoolJson"]],  # type: ignore
)

StringJson = TypeAliasType(  # type: ignore
    "StringJson",
    Union[str, Dict[str, "StringJson"]],  # type: ignore
)

FullJson = TypeAliasType(  # type: ignore
    "FullJson",
    Union[str, int, float, bool, None, Dict[str, "FullJson"], List["FullJson"]],  # type: ignore
)

NumericJson = TypeAliasType(  # type: ignore
    "NumericJson",
    Union[int, float, Dict[str, "NumericJson"]],  # type: ignore
)

NoListJson = TypeAliasType(  # type: ignore
    "NoListJson",
    Union[str, int, float, bool, None, Dict[str, "NoListJson"]],  # type: ignore
)

LabelJson = TypeAliasType(  # type: ignore
    "LabelJson",
    Union[bool, str, Dict[str, "LabelJson"]],  # type: ignore
)

Json = Dict[str, FullJson]  # type: ignore

Data = Dict[str, FullJson]  # type: ignore

Flags = Dict[str, LabelJson]  # type: ignore

Tags = Dict[str, LabelJson]  # type: ignore

Meta = Dict[str, FullJson]  # type: ignore

Hashes = Dict[str, StringJson]  # type: ignore

Metrics = Dict[str, NumericJson]  # type: ignore

Schema = Dict[str, FullJson]  # type: ignore

Mappings = Dict[str, str]


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


class Link(TraceID, SpanID):
    pass


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


class Header(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class Metadata(BaseModel):
    flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None


class Commit(BaseModel):
    author: Optional[UUID] = None
    date: Optional[datetime] = None
    message: Optional[str] = None


class Status(BaseModel):
    code: Optional[int] = 200
    message: Optional[str] = "Success"


class AliasConfig(BaseModel):
    model_config = {
        "populate_by_name": True,
        "from_attributes": True,
    }


def sync_alias(primary: str, alias: str, instance: BaseModel) -> None:
    primary_val = getattr(instance, primary)
    alias_val = getattr(instance, alias)

    if primary_val and alias_val is None:
        object.__setattr__(instance, alias, primary_val)
    elif alias_val and primary_val is None:
        object.__setattr__(instance, primary, alias_val)


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
