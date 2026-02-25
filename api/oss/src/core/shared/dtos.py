from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from agenta.sdk.models.shared import (  # noqa: F401
    BoolJson,
    StringJson,
    FullJson,
    NumericJson,
    NoListJson,
    LabelJson,
    #
    Json,
    Data,
    Metadata,
    Flags,
    Tags,
    Meta,
    Hashes,
    Metrics,
    Schema,
    #
    Lifecycle,
    Header,
    #
    Identifier,
    Slug,
    Version,
    Reference,
    #
    AliasConfig,
    sync_alias,
    #
    Commit,
    #
    Windowing,
)
from agenta.sdk.models.tracing import (  # noqa: F401
    TraceID,
    SpanID,
    Link,
    Links,
    Trace,
    Traces,
    Span,
    Spans,
)


class FolderScope(BaseModel):
    folder_id: Optional[UUID] = None


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    # DEPRECATING
    updated_by: Optional[str] = None  # email
