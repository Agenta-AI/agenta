from datetime import datetime
from typing import Any, Dict, List, Optional
from enum import Enum

from pydantic import BaseModel


class VariantActionEnum(str, Enum):
    START = "START"
    STOP = "STOP"


class VariantAction(BaseModel):
    action: VariantActionEnum


class CreateApp(BaseModel):
    app_name: str
    organization_id: Optional[str] = None


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
    organization_id: Optional[str] = None
    base_name: Optional[str]
    config_name: Optional[str]


class AppVariantFromImagePayload(BaseModel):
    variant_name: str


class AppVariantOutput(BaseModel):
    app_id: str
    app_name: str
    variant_id: str
    variant_name: str
    parameters: Optional[Dict[str, Any]]
    previous_variant_name: Optional[str]
    organization_id: str
    user_id: str
    base_name: str
    base_id: str
    config_name: str
    config_id: str
    uri: Optional[str]


class EnvironmentOutput(BaseModel):
    name: str
    app_id: str
    deployed_app_variant_id: Optional[str]
    deployed_variant_name: Optional[str]


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
    organization_id: Optional[str] = None


class RestartAppContainer(BaseModel):
    variant_id: str


class Image(BaseModel):
    docker_id: str
    tags: str
    organization_id: Optional[str] = None


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
    size: int
    digest: str
    status: str
    architecture: str
    title: str
    description: str
    last_pushed: datetime
    repo_name: str
    media_type: str


class Template(BaseModel):
    id: int
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
    image_id: str
    image_tag: str
    env_vars: Dict[str, str]
    organization_id: Optional[str] = None


class InviteRequest(BaseModel):
    email: str


class InviteToken(BaseModel):
    token: str


class Environment(BaseModel):
    name: str
    deployed_app_variant: Optional[str]
    deployed_base_name: Optional[str]
    deployed_config_name: Optional[str]
    organization_id: Optional[str] = None


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


class ListAPIKeysOutput(BaseModel):
    prefix: str
    created_at: datetime
    last_used_at: datetime
    expiration_date: datetime = None
