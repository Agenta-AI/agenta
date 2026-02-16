from typing import Optional
from uuid import UUID


from agenta.sdk.models.shared import (
    TraceID,
    SpanID,
    Link,
    Identifier,
    Slug,
    Version,
    Reference,
    Lifecycle,
    Header,
    Flags,
    Tags,
    Meta,
    Metadata,
    Data,
    Commit,
    AliasConfig,
    sync_alias,
)


class Blob(Identifier, Lifecycle):
    flags: Optional[Flags] = None  # type: ignore
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore

    data: Optional[Data] = None  # type: ignore

    set_id: Optional[UUID] = None
