from typing import List, Optional

from pydantic import BaseModel, Field

from oss.src.core.mounts.dtos import (
    Mount,
    MountCreate,
    MountCredentials,
    MountEdit,
    MountFile,
    MountQuery,
)
from oss.src.core.shared.dtos import Windowing


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class MountCreateRequest(BaseModel):
    mount: MountCreate


class MountEditRequest(BaseModel):
    mount: MountEdit


class MountQueryRequest(BaseModel):
    mount: Optional[MountQuery] = None
    windowing: Optional[Windowing] = None


class AgentMountQueryRequest(BaseModel):
    artifact_id: str
    name: str = "default"


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class MountResponse(BaseModel):
    count: int = 0
    mount: Optional[Mount] = None


class MountsResponse(BaseModel):
    count: int = 0
    mounts: List[Mount] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# File-op response models
# ---------------------------------------------------------------------------


class MountFileListResponse(BaseModel):
    count: int = 0
    files: List[MountFile] = Field(default_factory=list)


class MountFileContentResponse(BaseModel):
    path: str
    content: str


class MountFileWrittenResponse(BaseModel):
    path: str
    size: int = 0


class MountFolderCreatedResponse(BaseModel):
    path: str


class MountFileDeletedResponse(BaseModel):
    deleted: str
    count: int = 0


# ---------------------------------------------------------------------------
# Signed-credentials response (sandbox injection)
# ---------------------------------------------------------------------------


class MountCredentialsResponse(BaseModel):
    count: int = 0
    mount: Optional[Mount] = None
    credentials: Optional[MountCredentials] = None
