from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.browser_profiles.dtos import (
    BrowserProfile,
    BrowserProfileCreate,
    BrowserProfileEdit,
)


class BrowserProfileCreateRequest(BaseModel):
    profile: BrowserProfileCreate = Field(
        ...,
        description="Profile name and the sites (host names) its browser may open.",
    )


class BrowserProfileEditRequest(BaseModel):
    profile: BrowserProfileEdit = Field(
        ...,
        description="Fields to change. Omitted fields keep their value.",
    )


class BrowserProfileResponse(BaseModel):
    count: int = 0
    profile: Optional[BrowserProfile] = None


class BrowserProfilesResponse(BaseModel):
    count: int = 0
    profiles: List[BrowserProfile] = Field(default_factory=list)


class BrowserLiveStatusRequest(BaseModel):
    session_id: str


class BrowserAvailableRequest(BaseModel):
    revision_id: Optional[UUID] = None
    is_draft: bool = False


class BrowserAvailableResponse(BaseModel):
    count: int = 0
    profile_ids: List[UUID] = []
    # False when the run may never use the caller's logins (another person's revision).
    eligible: bool = False


class BrowserLiveStatusResponse(BaseModel):
    running: bool = False
