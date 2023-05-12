from pydantic import BaseModel
from typing import List


class AppVersion(BaseModel):
    app_name: str
    version_name: str


class Image(BaseModel):
    docker_id: str
    tags: str


class URI(BaseModel):
    uri: str
