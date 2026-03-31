from typing import Optional
from uuid import UUID


from agenta.sdk.models.shared import (
    Identifier,
    Lifecycle,
    Flags,
    Tags,
    Meta,
    Data,
)


class Blob(Identifier, Lifecycle):
    flags: Optional[Flags] = None  # type: ignore
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore

    data: Optional[Data] = None  # type: ignore

    set_id: Optional[UUID] = None
