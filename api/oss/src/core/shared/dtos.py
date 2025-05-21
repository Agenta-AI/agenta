from typing import Optional, Dict, List, Union, Any
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel

from typing_extensions import TypeAliasType


# --- Recursive Named TypeAliases using TypeAliasType ---


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
    Union[int, float, List[int], List[float], Dict[str, "NumericJson"]],
)

Json = Dict[str, FullJson]

Data = Dict[str, FullJson]

Metadata = Dict[str, FullJson]

Tags = Dict[str, StringJson]

Metrics = Dict[str, NumericJson]

Flags = Dict[str, bool]


class LifecycleDTO(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    updated_by_id: Optional[UUID] = None

    class Config:
        json_encoders = {
            UUID: str,
            datetime: lambda v: v.isoformat() if v else None,
        }

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.Config.json_encoders.items():
            if isinstance(data, type_):
                return encoder(data)
        return data

    def model_dump(self, *args, **kwargs) -> dict:
        kwargs.setdefault("exclude_none", True)

        return self.encode(super().model_dump(*args, **kwargs))


class Lifecycle(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    created_by_id: Optional[UUID] = None
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None

    class Config:
        json_encoders = {
            UUID: str,
            datetime: lambda v: v.isoformat() if v else None,
        }

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.Config.json_encoders.items():
            if isinstance(data, type_):
                return encoder(data)
        return data

    def model_dump(self, *args, **kwargs) -> dict:
        kwargs.setdefault("exclude_none", True)

        return self.encode(super().model_dump(*args, **kwargs))


class Identifier(BaseModel):
    id: Optional[UUID] = None

    class Config:
        json_encoders = {UUID: str}

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.Config.json_encoders.items():
            if isinstance(data, type_):
                return encoder(data)
        return data

    def model_dump(self, *args, **kwargs) -> dict:
        kwargs.setdefault("exclude_none", True)

        return self.encode(super().model_dump(*args, **kwargs))


class Slug(BaseModel):
    slug: Optional[str] = None


class Version(BaseModel):
    version: Optional[str] = None


class Header(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class Reference(BaseModel):
    id: Optional[UUID] = None
    slug: Optional[str] = None
    version: Optional[str] = None
    attributes: Optional[Json] = None

    class Config:
        json_encoders = {UUID: str}

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.Config.json_encoders.items():
            if isinstance(data, type_):
                return encoder(data)
        return data

    def model_dump(self, *args, **kwargs) -> dict:
        kwargs.setdefault("exclude_none", True)

        return self.encode(super().model_dump(*args, **kwargs))


References = List[Reference]
