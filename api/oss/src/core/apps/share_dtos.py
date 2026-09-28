"""Data contracts for shared app snapshots."""

from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

# entry key ("file:<path>" | "url:<url>") -> reference as written -> {"file"|"url": target}
ShareRefs = Dict[str, Dict[str, Dict[str, str]]]


class ShareIssue(BaseModel):
    """A captured URL that failed (`url`, `reason`) or a warning about a file (`code`, `path`)."""

    code: Optional[str] = None
    url: Optional[str] = None
    path: Optional[str] = None
    reason: Optional[str] = None


class ShareFileEntry(BaseModel):
    sha256: str
    size: int
    content_type: str
    # Captured files only: where the last redirect landed.
    final_url: Optional[str] = None


class ShareManifest(BaseModel):
    """One version of a share, stored as `v<N>.json` under the drive's share prefix."""

    version: int
    name: str
    entry: str
    kit: bool = True
    created_at: datetime
    created_by_id: UUID
    restored_from: Optional[int] = None
    files: Dict[str, ShareFileEntry] = Field(default_factory=dict)
    external: Dict[str, ShareFileEntry] = Field(default_factory=dict)
    refs: ShareRefs = Field(default_factory=dict)
    warnings: List[ShareIssue] = Field(default_factory=list)
