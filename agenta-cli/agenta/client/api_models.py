from pydantic import BaseModel
from typing import List, Optional, Dict, Any


class AppVariant(BaseModel):
    app_id: str
    app_name: str
    variant_name: str
    variant_id: str
    parameters: Optional[Dict[str, Any]]
    previous_variant_name: Optional[str]
    base_name: Optional[str]
    config_name: Optional[str]


class Variant(BaseModel):
    variant_id: str


class Image(BaseModel):
    docker_id: str
    tags: str


class URI(BaseModel):
    uri: str


class VariantConfigPayload(BaseModel):
    app_name: str
    base_name: str
    config_name: str
    parameters: Dict[str, Any]
    overwrite: bool
