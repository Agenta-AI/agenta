from datetime import datetime
from typing import List, Optional, Dict
from sqlmodel import SQLModel, Field, JSON, Column


class ImageDB(SQLModel, table=True):
    """Defines the info needed to get an image and connect it to the app variant"""

    id: int = Field(default=None, primary_key=True)
    docker_id: str = Field(...)
    tags: str = Field(...)


class AppVariantDB(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    app_name: str = Field(...)
    variant_name: str = Field(...)
    image_id: int = Field(foreign_key="imagedb.id")
    parameters: Dict = Field(sa_column=Column(JSON))
    previous_variant_name: Optional[str] = Field(default=None)
    is_deleted: bool = Field(
        default=False
    )  # soft deletion for using the template variants


class TemplateDB(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    template_id: int = Field(...)
    name: str = Field(...)
    repo_name: str = Field(...)
    architecture: str = Field(...)
    title: str = Field(...)
    description: str = Field(...)
    size: int = Field(...)
    digest: str = Field(...)
    status: str = Field(...)
    media_type: str = Field()
    last_pushed: datetime = Field(...)
