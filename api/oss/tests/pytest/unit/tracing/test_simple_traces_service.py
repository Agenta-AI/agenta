from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest

from oss.src.core.annotations.general_fields import AnnotationGeneralFields
from oss.src.core.shared.dtos import Link, Reference
from oss.src.core.tracing.dtos import (
    AgAnnotationAttributes,
    AnnotationScope,
    OTelLink,
    SimpleTrace,
    SimpleTraceChannel,
    SimpleTraceCreate,
    SimpleTraceEdit,
    SimpleTraceKind,
    SimpleTraceOrigin,
    SimpleTraceReferences,
)
from oss.src.core.tracing.service import SimpleTracesService
from oss.src.core.tracing.utils.traces import SUBJECT_ROLE


@pytest.mark.asyncio
async def test_edit_uses_incoming_references_and_links():
    tracing_service = AsyncMock()
    tracing_service.edit_trace.return_value = [
        OTelLink(trace_id="new-trace", span_id="new-span")
    ]

    service = SimpleTracesService(
        tracing_service=tracing_service,
        annotation_general_fields_service=AsyncMock(),
    )
    service._build_from_parsed = Mock(
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

    with (
        patch(
            "oss.src.core.tracing.service.parse_simple_trace",
            return_value=SimpleNamespace(span=SimpleNamespace(attributes={})),
        ),
        patch(
            "oss.src.core.tracing.service.build_simple_trace_attributes",
            return_value={"ag": {}},
        ) as build_attributes,
    ):
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


def _create_service(*, evaluator_revision):
    """A service whose general-fields builder adds a subject link to a request
    that has none, as it does for turn and session annotations."""
    tracing_service = AsyncMock()
    tracing_service.create_trace.return_value = [
        OTelLink(trace_id="note-trace", span_id="note-span")
    ]

    general_fields_service = AsyncMock()
    general_fields_service.build.return_value = AnnotationGeneralFields(
        links=[
            Link(
                trace_id="turn-trace",
                span_id="turn-span",
                attributes={"key": SUBJECT_ROLE},
            )
        ],
        session_id="s-1",
        annotation=AgAnnotationAttributes(scope=AnnotationScope.SESSION),
    )

    evaluators_service = AsyncMock()
    evaluators_service.fetch_evaluator_revision.return_value = evaluator_revision
    evaluators_service.fetch_evaluator.return_value = SimpleNamespace(
        slug="session-notes"
    )
    evaluators_service.fetch_evaluator_variant.return_value = SimpleNamespace(
        slug="default"
    )

    simple_evaluators_service = AsyncMock()
    simple_evaluators_service.create.return_value = SimpleNamespace(
        id=uuid4(),
        slug="session-notes",
        variant_id=uuid4(),
        revision_id=uuid4(),
    )

    service = SimpleTracesService(
        tracing_service=tracing_service,
        annotation_general_fields_service=general_fields_service,
        evaluators_service=evaluators_service,
        simple_evaluators_service=simple_evaluators_service,
    )
    return service, simple_evaluators_service


async def _create_session_note(service):
    return await service.create(
        organization_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        can_view_session=AsyncMock(return_value=True),
        trace_create=SimpleTraceCreate(
            scope=AnnotationScope.SESSION,
            session_id="s-1",
            data={"note": "good"},
            references=SimpleTraceReferences(evaluator=Reference(slug="session-notes")),
            links=[],
        ),
    )


@pytest.mark.asyncio
async def test_generated_subject_link_creates_an_unknown_evaluator():
    service, simple_evaluators_service = _create_service(evaluator_revision=None)

    # Another unit test stubs `genson` when it is imported first.
    with patch("oss.src.core.tracing.service.SchemaBuilder") as schema_builder:
        schema_builder.return_value.to_schema.return_value = {"type": "object"}
        result = await _create_session_note(service)

    simple_evaluators_service.create.assert_awaited_once()
    assert (
        simple_evaluators_service.create.await_args.kwargs[
            "simple_evaluator_create"
        ].slug
        == "session-notes"
    )
    assert result.references.evaluator.id is not None


@pytest.mark.asyncio
async def test_generated_subject_link_resolves_an_existing_evaluator():
    revision = SimpleNamespace(
        id=uuid4(),
        slug="rev",
        version="3",
        evaluator_id=uuid4(),
        evaluator_variant_id=uuid4(),
    )
    service, simple_evaluators_service = _create_service(evaluator_revision=revision)

    result = await _create_session_note(service)

    simple_evaluators_service.create.assert_not_awaited()
    assert result.references.evaluator.id == revision.evaluator_id
    assert result.references.evaluator_variant.id == revision.evaluator_variant_id
    assert result.references.evaluator_revision.id == revision.id
    # The response carries the generated subject link that was stored.
    assert result.links[0].span_id == "turn-span"
