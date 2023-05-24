from pydantic import BaseModel
from typing import List, Optional


class AppVariant(BaseModel):
    app_name: str
    variant_name: str
    parameters: Optional[dict]


class Image(BaseModel):
    docker_id: str
    tags: str


class URI(BaseModel):
    uri: str


class App(BaseModel):
    app_name: str
