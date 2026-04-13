from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.annotations.service import AnnotationsService
from oss.src.core.invocations.service import InvocationsService


@pytest.mark.asyncio
async def test_invocation_query_does_not_force_evaluator_flag():
    service = InvocationsService(
        applications_service=AsyncMock(),
        simple_applications_service=AsyncMock(),
        tracing_service=AsyncMock(),
    )
    service._query_invocation = AsyncMock(return_value=[])

    await service.query(project_id=uuid4())

    flags = service._query_invocation.await_args.kwargs["flags"]
    assert flags.is_evaluator is None


@pytest.mark.asyncio
async def test_annotation_query_does_not_force_evaluator_flag():
    service = AnnotationsService(
        evaluators_service=AsyncMock(),
        simple_evaluators_service=AsyncMock(),
        tracing_service=AsyncMock(),
    )
    service._query_annotation = AsyncMock(return_value=[])

    await service.query(project_id=uuid4())

    flags = service._query_annotation.await_args.kwargs["flags"]
    assert flags.is_evaluator is None
