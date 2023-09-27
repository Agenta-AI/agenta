from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class CreateApp(BaseModel):
    app_name: str
    

class CreateAppOutput(BaseModel):
    app_id: str
    app_name: str


class Variant(BaseModel):
    variant_id: str


class UpdateVariantParameterPayload(BaseModel):
    variant_id: str
    parameters: Dict[str, Any]


class AppVariant(BaseModel):
    app_id: str
    app_name: str
    variant_name: str
    parameters: Optional[Dict[str, Any]]
    previous_variant_name: Optional[str]
    organization_id: Optional[str] = None


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


class EnvironmentOutput(BaseModel):
    name: str
    app_id: str
    deployed_app_variant_id: Optional[str]


class AddVariantFromPreviousPayload(BaseModel):
    previous_variant_id: str
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
