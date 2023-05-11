from pydantic import BaseModel
from typing import Any
# from sqlmodel import SQLModel, Field


class Container(BaseModel):
    id: str
    image: str
    status: str
    name: str

# Add LiteSQL model for container representation in the database


# class ContainerDB(SQLModel, table=True):
#     id: str = Field(default=None, primary_key=True)
#     image: str
#     status: str
#     name: str
