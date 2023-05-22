from pydantic import BaseModel
from typing import List


class AppVariant(BaseModel):
    app_name: str
    variant_name: str


class Image(BaseModel):
    docker_id: str
    tags: str


class URI(BaseModel):
    uri: str
