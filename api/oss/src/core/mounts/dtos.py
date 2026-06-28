from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Slug,
)


class MountData(BaseModel):
    bucket: str
    prefix: str


class MountFlags(BaseModel):
    pass


class Mount(Identifier, Slug, Header, Lifecycle):
    project_id: UUID
    session_id: Optional[str] = None
    #
    data: MountData
    #
    flags: MountFlags = Field(default_factory=MountFlags)


class MountCreate(Slug, Header):
    session_id: Optional[str] = None
    #
    data: MountData
    #
    flags: MountFlags = Field(default_factory=MountFlags)


class MountEdit(Identifier, Header):
    flags: MountFlags = Field(default_factory=MountFlags)


class MountQuery(BaseModel):
    session_id: Optional[str] = None
    include_archived: bool = False


# --- File ops (durable store contents, sandbox-independent) ----------------- #


class MountFile(BaseModel):
    # path is relative to the mount prefix; is_folder marks prefix entries.
    path: str
    size: int = 0
    is_folder: bool = False


class MountFileList(BaseModel):
    files: List[MountFile] = Field(default_factory=list)


class MountFileContent(BaseModel):
    path: str
    content: str


class MountFileWritten(BaseModel):
    path: str
    size: int = 0


class MountFolderCreated(BaseModel):
    path: str


class MountFileDeleted(BaseModel):
    deleted: str
    count: int = 0
