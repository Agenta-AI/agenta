from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import Windowing
from oss.src.core.skills.dtos import SkillRegistryItem


class SkillsQueryRequest(BaseModel):
    search: Optional[str] = None
    include_archived: Optional[bool] = None
    windowing: Optional[Windowing] = None


class SkillsResponse(BaseModel):
    count: int = 0
    skills: List[SkillRegistryItem] = []
    builtin: List[SkillRegistryItem] = []
    windowing: Optional[Windowing] = None
