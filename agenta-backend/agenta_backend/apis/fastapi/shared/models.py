from pydantic import BaseModel


class VersionedModel(BaseModel):
    version: str
