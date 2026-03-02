from enum import Enum
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from oss.src.models.shared_models import ConfigDB


class TimestampModel(BaseModel):
    created_at: str = Field(str(datetime.now(timezone.utc)))
    updated_at: str = Field(str(datetime.now(timezone.utc)))


class PaginationParam(BaseModel):
    page: int = Field(default=1, ge=1)
    pageSize: int = Field(default=10, ge=1)


class SorterParams(BaseModel):
    created_at: str = Field("desc")


class WithPagination(BaseModel):
    data: List[Any]
    total: int
    page: int
    pageSize: int


class Error(BaseModel):
    message: str
    stacktrace: Optional[str] = None


class Result(BaseModel):
    type: str
    value: Optional[Any] = None
    error: Optional[Error] = None


class GetConfigResponse(BaseModel):
    config_name: str
    current_version: int
    parameters: Dict[str, Any]


class VariantActionEnum(str, Enum):
    START = "START"
    STOP = "STOP"


class VariantAction(BaseModel):
    action: VariantActionEnum


class CreateApp(BaseModel):
    app_name: str
    template_key: Optional[str] = None
    project_id: Optional[str] = None
    workspace_id: Optional[str] = None
    folder_id: Optional[str] = None


class CreateAppOutput(BaseModel):
    app_id: str
    app_name: str
    app_type: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    folder_id: Optional[str] = None


class UpdateApp(BaseModel):
    app_name: Optional[str] = None
    folder_id: Optional[str] = None


class UpdateAppOutput(CreateAppOutput):
    pass


class ReadAppOutput(CreateAppOutput):
    pass


class AppOutput(CreateAppOutput):
    pass


class UpdateVariantParameterPayload(BaseModel):
    parameters: Dict[str, Any]
    commit_message: Optional[str] = None


class UpdateVariantURLPayload(BaseModel):
    url: str
    variant_id: str
    commit_message: Optional[str] = None


class AppVariant(BaseModel):
    app_id: str
    app_name: str
    project_id: Optional[str] = None
    variant_name: str
    parameters: Optional[Dict[str, Any]]
    previous_variant_name: Optional[str]
    base_name: Optional[str]
    config_name: Optional[str]


class AppVariantResponse(BaseModel):
    app_id: str
    app_name: str
    variant_id: str
    variant_name: str
    project_id: str
    base_name: str
    base_id: str
    config_name: str
    uri: Optional[str] = None
    revision: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    modified_by_id: Optional[str] = None


class AppVariantRevision(BaseModel):
    id: Optional[str] = None
    variant_id: Optional[str] = None
    revision: int
    modified_by: Optional[str] = None
    config: ConfigDB
    created_at: str
    commit_message: Optional[str] = None


class AppVariantOutputExtended(BaseModel):
    app_id: str
    app_name: str
    variant_id: str
    variant_name: str
    parameters: Optional[Dict[str, Any]]
    previous_variant_name: Optional[str]
    user_id: str
    base_name: str
    base_id: str
    config_name: str
    uri: Optional[str]
    revision: int
    revisions: List[AppVariantRevision]


class EnvironmentOutput(BaseModel):
    name: str
    app_id: str
    project_id: str
    deployed_app_variant_id: Optional[str] = None
    deployed_variant_name: Optional[str] = None
    deployed_app_variant_revision_id: Optional[str] = None
    revision: Optional[int] = None


class EnvironmentRevision(BaseModel):
    id: str
    revision: int
    modified_by: str
    deployed_app_variant_revision: Optional[str] = None
    deployment: Optional[str] = None
    commit_message: Optional[str] = None
    created_at: str
    deployed_variant_name: Optional[str] = None


class EnvironmentOutputExtended(EnvironmentOutput):
    revisions: List[EnvironmentRevision]


class AddVariantFromPreviousPayload(BaseModel):
    new_variant_name: str
    parameters: Dict[str, Any]


class AddVariantFromBasePayload(BaseModel):
    base_id: str
    new_variant_name: str
    new_config_name: str
    parameters: Dict[str, Any]
    commit_message: Optional[str] = None


class RestartAppContainer(BaseModel):
    variant_id: str


class AddVariantFromURLPayload(BaseModel):
    variant_name: str
    url: str
    commit_message: Optional[str] = None
    base_name: Optional[str] = None
    config_name: Optional[str] = None


class AddVariantFromKeyPayload(BaseModel):
    variant_name: str
    key: str
    commit_message: Optional[str] = None
    base_name: Optional[str] = None
    config_name: Optional[str] = None


class App(BaseModel):
    app_id: str
    app_name: str
    app_type: Optional[str] = None
    folder_id: Optional[str] = None
    updated_at: Optional[str] = None


class RemoveApp(BaseModel):
    app_id: str


class Environment(BaseModel):
    name: str
    deployed_app_variant: Optional[str]
    deployed_base_name: Optional[str]
    deployed_config_name: Optional[str]


class DeployToEnvironmentPayload(BaseModel):
    environment_name: str
    variant_id: str
    commit_message: Optional[str] = None


class TestsetOutput(BaseModel):
    id: str
    name: str
    csvdata: List[Dict[str, Any]]
    created_at: str
    updated_at: str
    columns: List[str] = Field(default_factory=list)


class PostVariantConfigPayload(BaseModel):
    app_name: str
    base_name: str
    config_name: str
    parameters: Dict[str, Any]
    overwrite: bool


class BaseOutput(BaseModel):
    base_id: str
    base_name: str


class ListAPIKeysResponse(BaseModel):
    prefix: str
    created_at: str
    last_used_at: Optional[str] = None
    expiration_date: Optional[str] = None
