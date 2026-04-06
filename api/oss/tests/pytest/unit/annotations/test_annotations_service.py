import sys
from datetime import datetime, timezone
from types import SimpleNamespace
import types
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest


from oss.src.core.annotations.service import AnnotationsService
from oss.src.core.annotations.types import (
    Annotation,
    AnnotationChannel,
    AnnotationEdit,
    AnnotationKind,
    AnnotationOrigin,
)
from oss.src.core.shared.dtos import Link

sys.modules.setdefault("genson", types.SimpleNamespace(SchemaBuilder=object))


@pytest.mark.asyncio
async def test_edit_returns_updated_references_and_links():
    evaluators_service = AsyncMock()
    evaluators_service.fetch_evaluator_revision.return_value = SimpleNamespace(
        evaluator_id=uuid4(),
        evaluator_variant_id=uuid4(),
        id=uuid4(),
        slug="eval-rev",
        version="v2",
        data=SimpleNamespace(schemas=SimpleNamespace(outputs={})),
    )

    service = AnnotationsService(
        evaluators_service=evaluators_service,
        simple_evaluators_service=AsyncMock(),
        tracing_service=AsyncMock(),
    )
    service._fetch_annotation = AsyncMock(
        return_value=Annotation(
            trace_id="old-trace",
            span_id="old-span",
            created_at=datetime.now(timezone.utc),
            origin=AnnotationOrigin.CUSTOM,
            kind=AnnotationKind.ADHOC,
            channel=AnnotationChannel.API,
            data={"value": "before"},
            references={"evaluator": {"slug": "old-evaluator"}},
            links={"old": Link(trace_id="old-parent", span_id="old-span")},
        )
    )
    service._edit_annotation = AsyncMock(
        return_value=Link(trace_id="new-trace", span_id="new-span")
    )

    annotation_edit = AnnotationEdit(
        data={"value": "after"},
        references={"evaluator": {"slug": "new-evaluator"}},
        links={"scope": Link(trace_id="scope-trace", span_id="scope-span")},
    )

    with patch(
        "oss.src.core.annotations.service.validate_data_against_schema",
        return_value=None,
    ):
        result = await service.edit(
            organization_id=uuid4(),
            project_id=uuid4(),
            user_id=uuid4(),
            trace_id="old-trace",
            annotation_edit=annotation_edit,
        )

    assert result is not None
    assert result.references.evaluator.slug == "new-evaluator"
    assert result.links["scope"].trace_id == "scope-trace"
