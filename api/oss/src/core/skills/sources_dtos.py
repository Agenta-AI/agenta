from typing import Optional, List
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel


class SkillSource(BaseModel):
    id: Optional[UUID] = None
    slug: Optional[str] = None
    repo_url: str
    ref: Optional[str] = None
    last_seen_commit_sha: Optional[str] = None
    sync_enabled: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class SkillSourceCreate(BaseModel):
    slug: str
    repo_url: str
    ref: Optional[str] = None
    last_seen_commit_sha: Optional[str] = None
    sync_enabled: bool = False


class SkillSourceLink(BaseModel):
    id: Optional[UUID] = None
    source_id: UUID
    workflow_id: UUID
    path_in_repo: str
    imported_commit_sha: Optional[str] = None
    content_hash: Optional[str] = None
    detached: bool = False
    missing_in_source: bool = False


class SkillSourceLinkCreate(BaseModel):
    source_id: UUID
    workflow_id: UUID
    path_in_repo: str
    imported_commit_sha: Optional[str] = None
    content_hash: Optional[str] = None


class SkillSourceWithLinks(BaseModel):
    source: SkillSource
    links: List[SkillSourceLink] = []
