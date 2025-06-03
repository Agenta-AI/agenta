from typing import Optional
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Version,
    Lifecycle,
    Flags,
    Meta,
    Header,
    Data,
)


class Commit(BaseModel):
    author: Optional[UUID] = None
    date: Optional[datetime] = None
    message: Optional[str] = None


class Artifact(Identifier, Slug, Lifecycle, Header):
    flags: Optional[Flags] = None
    meta: Optional[Meta] = None


class Variant(Identifier, Slug, Lifecycle, Header):
    flags: Optional[Flags] = None
    meta: Optional[Meta] = None

    artifact_id: Optional[UUID] = None
    artifact: Optional[Artifact] = None


class Revision(Identifier, Slug, Version, Lifecycle, Header, Commit):
    flags: Optional[Flags] = None
    meta: Optional[Meta] = None

    data: Optional[Data] = None

    artifact_id: Optional[UUID] = None
    artifact: Optional[Artifact] = None

    variant_id: Optional[UUID] = None
    variant: Optional[Variant] = None
