from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Slug,
)


class MountData(BaseModel):
    # Storage location is derived server-side (bucket from env, key = project_id/mount_id),
    # never caller-supplied. Kept as an (empty) model for forward-compatible mount metadata.
    pass


class MountFlags(BaseModel):
    pass


class Mount(Identifier, Slug, Header, Lifecycle):
    project_id: UUID
    session_id: Optional[str] = None
    #
    data: MountData = Field(default_factory=MountData)
    #
    flags: MountFlags = Field(default_factory=MountFlags)
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class MountCreate(Slug, Header):
    session_id: Optional[str] = None
    #
    flags: MountFlags = Field(default_factory=MountFlags)
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class MountEdit(Identifier, Header):
    flags: MountFlags = Field(default_factory=MountFlags)
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class MountQuery(BaseModel):
    session_id: Optional[str] = None
    include_archived: bool = False


# --- File ops (durable store contents, sandbox-independent) ----------------- #


class MountFile(BaseModel):
    # path is relative to the mount prefix; is_folder marks prefix entries.
    path: str
    size: int = 0
    is_folder: bool = False
    # Object-store LastModified as epoch milliseconds; None when the store omits it. Lets the UI
    # order files by recency regardless of how they were created (bash, Write tool, upload).
    mtime: Optional[int] = None
    # Direct-child count for a folder entry — only set when the recency view rolls a whole
    # freshly-written directory (e.g. a `git clone`) up into ONE folder row instead of flooding the
    # "recent files" list with its leaves. None for real files.
    item_count: Optional[int] = None


class MountFileList(BaseModel):
    files: List[MountFile] = Field(default_factory=list)
    # Entries this view would return BEFORE any limit — so a limited "latest N" listing still reports
    # the true total (the UI badge) without shipping the whole tree. Its unit follows the view: leaf
    # files only in the recency listing (order/limit set), files-plus-folders in the shallow (depth=1)
    # and browse modes.
    total: int = 0
    # `total` is a FLOOR, not exact — the count-only scan hit its cap on a very large tree, so the UI
    # shows "N+". False for an exhaustive count.
    total_capped: bool = False


class MountArchiveSource(BaseModel):
    """One mount to include in a download-all archive: which mount, which folder within it
    (`source_path`; "" = the whole mount), and the prefix its files sit under in the zip (the folded
    drive layout)."""

    mount_id: UUID
    source_path: str = ""
    archive_prefix: str = ""


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


# --- Signed credentials (sandbox injection) --------------------------------- #


class MountCredentials(BaseModel):
    """Short-lived, prefix-scoped credentials for a single mount.

    Signed API-side from the store's STS endpoint; the master key never leaves the
    API. Scoped to `<bucket>/<project_id>/<mount_id>/*` and expires within minutes,
    so a leak grants only this mount's prefix for a short window.
    """

    endpoint: Optional[str] = None
    region: str = "us-east-1"
    bucket: str
    # geesefs key suffix: `<project_id>/<mount_id>` (mount prefix, slug-independent).
    prefix: str
    access_key: str
    secret_key: str
    session_token: Optional[str] = None
    expires_at: Optional[datetime] = None
