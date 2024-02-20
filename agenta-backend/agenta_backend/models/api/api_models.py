from enum import Enum
from datetime import datetime
from typing import Any, Dict, List, Optional, TypeVar, Generic

from fastapi import Query
from pydantic import BaseModel, Field

from agenta_backend.models.db_models import ConfigDB


# generic type for db models that will be
# translated into a pydantic model(s)
T = TypeVar("T")


class GenericObject(BaseModel):
    pass


class PaginationParam(BaseModel):
    page: int = Field(default=1, ge=1)
    pageSize: int = Field(default=10, ge=1)


class SorterParams(BaseModel):
    created_at: str = Field("desc")


class WithPagination(BaseModel, Generic[T]):
    data: List[T]
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
    config_id: Optional[str]
    config_name: str
    current_version: int
    parameters: Dict[str, Any]


class SaveConfigPayload(BaseModel):
    base_id: str
    config_name: str
    parameters: Dict[str, Any]
    overwrite: bool


class VariantActionEnum(str, Enum):
    START = "START"
    STOP = "STOP"


class VariantAction(BaseModel):
    action: VariantActionEnum


class CreateApp(BaseModel):
    app_name: str


class CreateAppOutput(BaseModel):
    app_id: str
    app_name: str


class AppOutput(CreateAppOutput):
    pass


class UpdateVariantParameterPayload(BaseModel):
    parameters: Dict[str, Any]


class AppVariant(BaseModel):
    app_id: str
    app_name: str
    variant_name: str
    parameters: Optional[Dict[str, Any]]
    previous_variant_name: Optional[str]
    base_name: Optional[str]
    config_name: Optional[str]


class AppVariantFromImagePayload(BaseModel):
    variant_name: str


class AppVariantResponse(BaseModel):
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


class AppVariantRevision(BaseModel):
    revision: int
    modified_by: str
    config: ConfigDB
    created_at: datetime


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
    deployed_app_variant_id: Optional[str]
    deployed_variant_name: Optional[str]
    deployed_app_variant_revision_id: Optional[str]
    revision: Optional[int]


class EnvironmentRevision(BaseModel):
    id: str
    revision: int
    modified_by: str
    deployed_app_variant_revision: Optional[str]
    deployment: Optional[str]
    created_at: datetime


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


class AppVariantFromImage(BaseModel):
    app_id: str
    variant_name: str
    parameters: Optional[Dict[str, Any]]
    previous_variant_name: Optional[str]


class RestartAppContainer(BaseModel):
    variant_id: str


class Image(BaseModel):
    type: Optional[str]
    docker_id: str
    tags: str


class AddVariantFromImagePayload(BaseModel):
    variant_name: str
    docker_id: str
    tags: str
    base_name: Optional[str]
    config_name: Optional[str]


class ImageExtended(Image):
    # includes the mongodb image id
    id: str


class TemplateImageInfo(BaseModel):
    name: str
    size: Optional[int] = None
    digest: Optional[str] = None
    title: str
    description: str
    last_pushed: Optional[datetime] = None
    repo_name: Optional[str] = None
    template_uri: Optional[str] = None


class Template(BaseModel):
    id: str
    image: TemplateImageInfo


class URI(BaseModel):
    uri: str


class App(BaseModel):
    app_id: str
    app_name: str


class RemoveApp(BaseModel):
    app_id: str


class DockerEnvVars(BaseModel):
    env_vars: Dict[str, str]


class CreateAppVariant(BaseModel):
    app_name: str
    template_id: str
    env_vars: Dict[str, str]


class Environment(BaseModel):
    name: str
    deployed_app_variant: Optional[str]
    deployed_base_name: Optional[str]
    deployed_config_name: Optional[str]


class DeployToEnvironmentPayload(BaseModel):
    environment_name: str
    variant_id: str


class TestSetOutput(BaseModel):
    id: str
    name: str
    csvdata: List[Dict[str, Any]]
    created_at: str
    updated_at: str


class PostVariantConfigPayload(BaseModel):
    app_name: str
    base_name: str
    config_name: str
    parameters: Dict[str, Any]
    overwrite: bool


class BaseOutput(BaseModel):
    base_id: str
    base_name: str
