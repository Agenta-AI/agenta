from typing import Optional
from uuid import UUID
from datetime import datetime

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
    TraceID,
    SpanID,
    Link,
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


class Status(BaseModel):
    timestamp: datetime
    type: Optional[str] = None
    code: Optional[str] = None
    message: Optional[str] = None
    stacktrace: Optional[str] = None


class FolderScope(BaseModel):
    folder_id: Optional[UUID] = None


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    # DEPRECATING
    updated_by: Optional[str] = None  # email
