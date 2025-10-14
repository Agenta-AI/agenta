from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import datetime, timezone

from oss.src.models.api.api_models import (
    CreateApp,
    AppVariant,
    Environment,
    AppVariantResponse,
    AppVariantOutputExtended,
    EnvironmentOutput,
    EnvironmentRevision,
    EnvironmentOutputExtended,
)


class TimestampModel(BaseModel):
    created_at: str = Field(str(datetime.now(timezone.utc)))
    updated_at: str = Field(str(datetime.now(timezone.utc)))


class InviteRequest(BaseModel):
    email: str
    roles: List[str]


class ReseendInviteRequest(BaseModel):
    email: str


class InviteToken(BaseModel):
    token: str


class CreateApp_(CreateApp):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None


class AppVariant_(AppVariant):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None


class Environment_(Environment):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None


class AppVariantResponse_(AppVariantResponse):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None


class AppVariantOutputExtended_(AppVariantOutputExtended):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None


class EnvironmentOutput_(EnvironmentOutput):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None


class EnvironmentRevision_(EnvironmentRevision):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None


class EnvironmentOutputExtended_(EnvironmentOutputExtended):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None
