from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import Windowing
from oss.src.core.skills.dtos import SkillRegistryItem, SkillUsageItem


class SkillsQueryRequest(BaseModel):
    search: Optional[str] = None
    include_archived: Optional[bool] = None
    windowing: Optional[Windowing] = None


class SkillsResponse(BaseModel):
    count: int = 0
    skills: List[SkillRegistryItem] = []
    builtin: List[SkillRegistryItem] = []
    windowing: Optional[Windowing] = None


class SkillSourceScanRequest(BaseModel):
    source_url: str
    ref: Optional[str] = None
    # Narrow resolution to one registered catalog provider; default = ask each.
    provider: Optional[str] = None


class SkillSourceImportRequest(BaseModel):
    source_url: str
    ref: Optional[str] = None
    provider: Optional[str] = None
    # Paths (from a prior scan) to import; omitted = every valid candidate.
    paths: Optional[List[str]] = None


class SkillCreateRequest(BaseModel):
    # The SkillTemplate payload (name/description/body/files + behaviour flags).
    skill: dict


class SkillCreateResponse(BaseModel):
    workflow_id: Optional[str] = None
    slug: Optional[str] = None
    revision_id: Optional[str] = None


class SkillCommitRequest(BaseModel):
    skill: dict
    message: Optional[str] = None
    # Optimistic concurrency: a moved head answers 409 instead of clobbering.
    base_revision_id: Optional[UUID] = None


class SkillCommitResponse(BaseModel):
    workflow_id: Optional[str] = None
    revision_id: Optional[str] = None
    version: Optional[str] = None


class SkillRevisionRow(BaseModel):
    id: Optional[str] = None
    version: Optional[str] = None
    message: Optional[str] = None
    created_at: Optional[str] = None
    workflow_variant_id: Optional[str] = None
    skill: Optional[dict] = None


class SkillRevisionsResponse(BaseModel):
    count: int = 0
    revisions: List[SkillRevisionRow] = []


class SkillReferencedByResponse(BaseModel):
    count: int = 0
    referenced_by: List[SkillUsageItem] = []
