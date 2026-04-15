from typing import Any, Dict, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field


class ReferenceRequestModel(BaseModel):
    slug: Optional[str] = None
    version: Optional[Union[int, str]] = None
    commit_message: Optional[str] = None
    id: Optional[UUID] = None


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    updated_by: Optional[str] = None


class ConfigResponseModel(BaseModel):
    params: Dict[str, Any] = Field(default_factory=dict)
    url: Optional[str] = None

    application_ref: Optional[ReferenceRequestModel] = None
    service_ref: Optional[ReferenceRequestModel] = None
    variant_ref: Optional[ReferenceRequestModel] = None
    environment_ref: Optional[ReferenceRequestModel] = None

    application_lifecycle: Optional[LegacyLifecycleDTO] = None
    service_lifecycle: Optional[LegacyLifecycleDTO] = None
    variant_lifecycle: Optional[LegacyLifecycleDTO] = None
    environment_lifecycle: Optional[LegacyLifecycleDTO] = None
