from typing import Optional

from pydantic import BaseModel


class StoreObject(BaseModel):
    """One object listed from the store: its key, byte size, and LastModified as epoch
    milliseconds (None when the store omits it)."""

    key: str
    size: int = 0
    mtime: Optional[int] = None
