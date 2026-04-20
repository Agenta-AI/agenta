from typing import Optional, List

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import Link, Windowing
from oss.src.core.tracing.dtos import (
    SimpleTrace,
    SimpleTraceCreate,
    SimpleTraceEdit,
    SimpleTraceQuery,
)


class SimpleTraceCreateRequest(BaseModel):
    """Request body for creating a single-span "simple" trace."""

    trace: SimpleTraceCreate = Field(
        description=(
            "The trace to create. Must include `data` (the payload being "
            "recorded) and typically `origin`, `kind`, and `channel` to "
            "describe where it came from. Optional `references` link the "
            "trace to Agenta entities (app, variant, revision, evaluator, "
            "testset, etc.)."
        ),
    )


class SimpleTraceEditRequest(BaseModel):
    trace: SimpleTraceEdit


class SimpleTraceQueryRequest(BaseModel):
    trace: Optional[SimpleTraceQuery] = None
    #
    links: Optional[List[Link]] = None
    #
    windowing: Optional[Windowing] = None


class SimpleTraceResponse(BaseModel):
    """Response from a single-trace create/fetch/edit."""

    count: int = Field(
        default=0,
        description="`1` if the trace was returned, `0` otherwise.",
    )
    trace: Optional[SimpleTrace] = Field(
        default=None,
        description=(
            "The created or fetched trace, including server-assigned "
            "`trace_id` and `span_id`."
        ),
    )


class SimpleTracesResponse(BaseModel):
    count: int = 0
    traces: List[SimpleTrace] = []


class SimpleTraceLinkResponse(BaseModel):
    count: int = 0
    link: Optional[Link] = None
