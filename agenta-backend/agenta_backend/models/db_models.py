from sqlmodel import SQLModel, Field, JSON, Column
from typing import List, Optional, Dict


class ImageDB(SQLModel, table=True):
    """Defines the info needed to get an image and connect it to the app variant
    """
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
    is_deleted: bool = Field(default=False)  # soft deletion for using the template variants
