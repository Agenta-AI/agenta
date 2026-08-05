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
    """Request body for editing an existing "simple" trace."""

    trace: SimpleTraceEdit = Field(
        description=(
            "The fields to update. `data` is required. `tags`, `meta`, "
            "`references`, and `links` overwrite their current values "
            "when present."
        ),
    )


class SimpleTraceQueryRequest(BaseModel):
    """Request body for `POST /simple/traces/query`."""

    trace: Optional[SimpleTraceQuery] = Field(
        default=None,
        description=(
            "Filter fields on the trace itself — `origin`, `kind`, "
            "`channel`, `tags`, `meta`, `references`, and inbound `links`. "
            "Filtering by `trace.links.invocation` is the common pattern "
            "for finding annotations on a given span."
        ),
    )
    #
    links: Optional[List[Link]] = Field(
        default=None,
        description=(
            "Batch GET by the trace's own `(trace_id, span_id)`. Each "
            "entry matches the trace whose own identity equals the pair. "
            "Distinct from `trace.links`, which filters on inbound links."
        ),
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor pagination and time range.",
    )


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
    """Response from `POST /simple/traces/query`."""

    count: int = Field(
        default=0,
        description="Number of matching traces in this page.",
    )
    traces: List[SimpleTrace] = Field(
        default=[],
        description="The matching traces in the high-level `SimpleTrace` shape.",
    )


class SimpleTraceLinkResponse(BaseModel):
    """Response from `DELETE /simple/traces/{trace_id}`."""

    count: int = Field(
        default=0,
        description="`1` if a trace was removed, `0` otherwise.",
    )
    link: Optional[Link] = Field(
        default=None,
        description="The `(trace_id, span_id)` pair that was removed.",
    )
