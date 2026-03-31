from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from oss.src.core.shared.dtos import Link, Reference
from oss.src.core.tracing.dtos import (
    OTelLink,
    SimpleTrace,
    SimpleTraceChannel,
    SimpleTraceEdit,
    SimpleTraceKind,
    SimpleTraceOrigin,
    SimpleTraceReferences,
)
from oss.src.core.tracing.service import SimpleTracesService


@pytest.mark.asyncio
async def test_edit_uses_incoming_references_and_links():
    tracing_service = AsyncMock()
    tracing_service.edit_trace.return_value = [
        OTelLink(trace_id="new-trace", span_id="new-span")
    ]

    service = SimpleTracesService(tracing_service=tracing_service)
    service.fetch = AsyncMock(
        return_value=SimpleTrace(
            trace_id="old-trace",
            span_id="old-span",
            created_at=datetime.now(timezone.utc),
            origin=SimpleTraceOrigin.CUSTOM,
            kind=SimpleTraceKind.ADHOC,
            channel=SimpleTraceChannel.API,
            data={"value": "before"},
            references=SimpleTraceReferences(application=Reference(slug="before")),
            links={"parent": Link(trace_id="parent-trace", span_id="parent-span")},
        )
    )

    trace_edit = SimpleTraceEdit(
        data={"value": "after"},
        references=SimpleTraceReferences(application=Reference(slug="after")),
        links={"scope": Link(trace_id="scope-trace", span_id="scope-span")},
    )

    with patch(
        "oss.src.core.tracing.service.build_simple_trace_attributes",
        return_value={"ag": {}},
    ) as build_attributes:
        result = await service.edit(
            organization_id=uuid4(),
            project_id=uuid4(),
            user_id=uuid4(),
            trace_id="old-trace",
            trace_edit=trace_edit,
        )

    assert build_attributes.call_args.kwargs["references"] == {
        "application": {"slug": "after"}
    }
    assert (
        tracing_service.edit_trace.await_args.kwargs["spans"][0].links[0].trace_id
        == "scope-trace"
    )
    assert result is not None
    assert result.references.application.slug == "after"
    assert result.links["scope"].trace_id == "scope-trace"
