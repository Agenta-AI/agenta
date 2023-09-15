from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Dict, Any


class AppVariant(BaseModel):
    app_name: str
    variant_name: str
    parameters: Optional[Dict[str, Any]]
    previous_variant_name: Optional[str]


class RestartAppContainer(BaseModel):
    app_name: str
    variant_name: str


class Image(BaseModel):
    docker_id: str
    tags: str


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
    app_name: str


class DockerEnvVars(BaseModel):
    env_vars: Dict[str, str]


class CreateAppVariant(BaseModel):
    app_name: str
    image_id: str
    image_tag: str
    env_vars: Dict[str, str]


class OrganizationInvite(BaseModel):
    organization_id: str
    email_address: str


class OrganizationToken(BaseModel):
    organization_id: str
    token: str
