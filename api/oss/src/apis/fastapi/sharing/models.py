from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.memberships.dtos import ProjectMemberProfile
from oss.src.core.shared.dtos import Windowing
from oss.src.core.sharing.dtos import (
    AgentSharingState,
    SessionRole,
    SessionSharingState,
    ShareDisclosure,
    Visibility,
)


class AgentVisibilityRequest(BaseModel):
    visibility: Visibility = Field(
        ...,
        description="`private`: only the owner sees the agent. `project`: every project member sees it.",
    )


class AgentTransferRequest(BaseModel):
    user_id: UUID = Field(
        ...,
        description="The new owner: an active human member of the project, not the current owner.",
    )


class SessionGrantRequest(BaseModel):
    user_id: UUID = Field(
        ...,
        description="The member who gets the grant: an active human member, not the owner.",
    )
    role: SessionRole = Field(
        ...,
        description="`viewer` reads the session. `participant` also sends to it.",
    )


class SessionVisibilityRequest(BaseModel):
    visibility: Visibility = Field(
        ...,
        description="`private`: the owner and the grantees see the session. `project`: every project member sees it.",
    )


class SharingMembersQueryRequest(BaseModel):
    search: Optional[str] = Field(
        default=None,
        description="Case-insensitive prefix of the member's email or name.",
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="`limit` (default 50) and `next` (the cursor of the previous page).",
    )


class AgentSharingResponse(BaseModel):
    count: int = 1
    sharing: AgentSharingState
    disclosure: ShareDisclosure


class SessionSharingResponse(BaseModel):
    count: int = 1
    sharing: SessionSharingState
    disclosure: Optional[ShareDisclosure] = Field(
        default=None,
        description="What sharing discloses. None when the session cannot be shared.",
    )


class SharingMembersResponse(BaseModel):
    count: int = 0
    members: List[ProjectMemberProfile] = []
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Present when there is a next page: pass it back to read that page.",
    )
