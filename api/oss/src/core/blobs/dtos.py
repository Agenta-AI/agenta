from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Lifecycle,
    Data,
    Flags,
    Tags,
    Meta,
    Windowing,  # noqa: F401
)


class Blob(Identifier, Lifecycle):
    flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[Data] = None

    set_id: Optional[UUID] = None


class BlobCreate(BaseModel):
    flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[Data] = None

    set_id: Optional[UUID] = None


class BlobEdit(Identifier):
    flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None


class BlobQuery(BaseModel):
    flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    set_ids: Optional[List[UUID]] = None
    blob_ids: Optional[List[UUID]] = None
