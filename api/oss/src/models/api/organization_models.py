from uuid import UUID
from typing import Optional, List, Dict, Any

from pydantic import BaseModel, Field, ConfigDict, model_validator

from oss.src.models.api.user_models import TimestampModel


class Organization(BaseModel):
    id: str
    slug: Optional[str] = None
    #
    name: Optional[str] = None
    description: Optional[str] = None
    #
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    #
    owner_id: str
    #
    members: List[str] = Field(default_factory=list)
    invitations: List = Field(default_factory=list)
    workspaces: List[str] = Field(default_factory=list)

    # Accept ORM rows (EE builds from DB, ids are UUID) or dicts (OSS); stringify
    # any UUID on the way in so the edition that built it doesn't leak through.
    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def _stringify_uuids(cls, data):
        if isinstance(data, dict):
            items = data.items()
        elif hasattr(data, "__dict__"):
            items = vars(data).items()
        else:
            return data
        return {
            key: str(value) if isinstance(value, UUID) else value
            for key, value in items
        }


class OrganizationMember(TimestampModel):
    id: Optional[str] = None
    email: str
    username: str
    status: Optional[str] = None


class OrganizationDetails(Organization):
    default_workspace: Optional[Dict[str, Any]] = None


class CreateOrganizationPayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class OrganizationUpdate(BaseModel):
    slug: Optional[str] = None

    name: Optional[str] = None
    description: Optional[str] = None

    # EE-only fields (slug immutability + auth/SSO/domain flags). OSS ignores
    # these — its update path only consumes name/description.
    flags: Optional[Dict[str, Any]] = None
    updated_at: Optional[str] = None
