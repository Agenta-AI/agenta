from typing import Optional, List
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel

from oss.src.core.shared.dtos import Windowing


class SkillRegistryItem(BaseModel):
    """One registry row: the skill's workflow identity plus its head revision.

    `name`/`description` come from the ARTIFACT (the display identity);
    `skill_name`/`skill_description` from the head revision's skill payload —
    they normally agree, but the artifact is authoritative for display.
    """

    # The head revision id doubles as `id`: pagination cursors ride the
    # revision UUID7 (the windowed column), so `compute_next_windowing` and
    # clients get a stable cursor without a bespoke field.
    id: Optional[UUID] = None

    workflow_id: Optional[UUID] = None
    workflow_slug: Optional[str] = None

    name: Optional[str] = None
    description: Optional[str] = None

    head_revision_id: Optional[UUID] = None
    version: Optional[str] = None
    message: Optional[str] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    is_static: bool = False
    # The workflow is archived (only listed when include_archived was requested).
    archived: bool = False

    skill_name: Optional[str] = None
    skill_description: Optional[str] = None
    files_count: Optional[int] = None

    # How many agents embed this skill (by workflow id or slug).
    used_by_count: Optional[int] = None
    # Import provenance derived from artifact `meta._ag.origin` (repo grouping,
    # "synced" display, and per-row detachment). None = authored in this project.
    origin: Optional["SkillOriginInfo"] = None


class SkillOriginInfo(BaseModel):
    provider: Optional[str] = None
    repository: Optional[str] = None
    ref: Optional[str] = None
    path: Optional[str] = None
    resolved_version: Optional[str] = None
    imported_at_url: Optional[str] = None
    # Derived on read: the head's content hash no longer matches the last
    # imported checkpoint — edited locally, never overwritten by updates.
    detached: bool = False


class SkillRegistryQuery(BaseModel):
    search: Optional[str] = None
    include_archived: Optional[bool] = None
    windowing: Optional[Windowing] = None


class SkillRegistryList(BaseModel):
    skills: List[SkillRegistryItem] = []
    # Code-defined Agenta built-ins: a separate, unpaginated block — merging
    # synthetic catalog entries into keyset pagination has no correct cursor
    # semantics.
    builtin: List[SkillRegistryItem] = []
    windowing: Optional[Windowing] = None


class SkillUsageItem(BaseModel):
    agent_workflow_id: Optional[UUID] = None
    agent_slug: Optional[str] = None
    agent_name: Optional[str] = None
    # "latest" — artifact-level embed, follows the head.
    # "pinned" — revision-level embed with an explicit version.
    mode: str = "latest"
    pinned_version: Optional[str] = None


class SkillUsageQuery(BaseModel):
    workflow_id: Optional[UUID] = None
    workflow_slug: Optional[str] = None
