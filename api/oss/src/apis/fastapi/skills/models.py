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


class SkillUsageRequest(BaseModel):
    workflow_id: Optional[UUID] = None
    workflow_slug: Optional[str] = None


class SkillUsageResponse(BaseModel):
    count: int = 0
    usage: List[SkillUsageItem] = []


class SkillSourceScanRequest(BaseModel):
    repo_url: str
    ref: Optional[str] = None


class SkillSourceImportRequest(BaseModel):
    repo_url: str
    ref: Optional[str] = None
    # Paths (from a prior scan) to import; omitted = every valid candidate.
    paths: Optional[List[str]] = None
    sync_enabled: bool = False
