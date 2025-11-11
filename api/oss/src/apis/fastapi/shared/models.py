from typing import Optional

from pydantic import BaseModel


class VersionedModel(BaseModel):
    version: Optional[str] = None
