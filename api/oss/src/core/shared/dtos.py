from typing import Optional
from pydantic import BaseModel


from agenta.sdk.models.shared import (
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
    TraceID,
    SpanID,
    Link,
    #
    Identifier,
    Slug,
    Version,
    Reference,
    ReferenceWithLimit,
    #
    AliasConfig,
    sync_alias,
    #
    Commit,
    #
    Windowing,
)


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    # DEPRECATING
    updated_by: Optional[str] = None  # email
