from typing import Optional

from pydantic import BaseModel


class StoreObject(BaseModel):
    """One object listed or stat'ed from the store: its key, byte size, LastModified as epoch
    milliseconds (None when the store omits it), and its unquoted ETag (None when unknown)."""

    key: str
    size: int = 0
    mtime: Optional[int] = None
    etag: Optional[str] = None


class StorePutResult(BaseModel):
    """Outcome of a put: bytes written and the object's new unquoted ETag."""

    size: int = 0
    etag: Optional[str] = None
