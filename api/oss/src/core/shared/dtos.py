from datetime import datetime, timezone
from typing import Annotated, Optional
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

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
    Selector,  # Base selector for data extraction
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


# An OpenTelemetry span id: 64-bit, exactly 16 hex chars. NOT a UUID (which is 128-bit /
# 32 hex). Typing this as UUID rejected every runner record-ingest with a 422 (16 vs 32 hex).
# Trace ids ARE 128-bit (32 hex) and correctly continue to ride as UUID.
OTelSpanId = Annotated[str, StringConstraints(pattern=r"^[0-9a-fA-F]{16}$")]


class Status(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
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
