from sqlmodel import SQLModel, Field
from typing import List, Optional


class ImageDB(SQLModel, table=True):
    """Defines the info needed to get an image and connect it to the app variant
    """
    id: int = Field(default=None, primary_key=True)
    docker_id: str = Field(...)
    tags: str = Field(...)


class AppVariantDB(SQLModel, table=True):
    """Defines an app variant and connects to an image    """
    id: Optional[int] = Field(default=None, primary_key=True)
    app_name: str = Field(...)
    variant_name: str = Field(...)
    image_id: int = Field(foreign_key="imagedb.id")


class App(SQLModel, table=True):
    """Defines an app / project """
    id: int = Field(default=None, primary_key=True)
    app_name: str = Field(...)
