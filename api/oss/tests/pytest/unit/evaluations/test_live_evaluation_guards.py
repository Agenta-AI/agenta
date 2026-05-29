# ruff: noqa: E402

import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

# Stub genson so importing oss.src.core.evaluations.tasks.live (which transitively
# pulls in services depending on it) does not require genson during unit tests.
sys.modules.setdefault("genson", types.SimpleNamespace(SchemaBuilder=object))

from oss.src.core.evaluators.dtos import EvaluatorRevision, EvaluatorRevisionData
from oss.src.core.queries.dtos import QueryRevision, QueryRevisionData
from oss.src.core.shared.dtos import Reference


@pytest.mark.asyncio
async def test_resolve_query_revisions_skips_revision_with_null_data():
    """A live evaluation must not run when the referenced query revision has no data.

    If the revision row exists but `data` is null, running it would issue an
    unfiltered tracing query and silently evaluate every trace in the project.
    """
    from oss.src.core.evaluations.tasks.live import _resolve_query_revisions

    revision_id = uuid4()
    revision_ref = Reference(id=revision_id)

    revision_without_data = QueryRevision(
        id=revision_id,
        slug="my-query",
        data=None,
    )

    queries_service = SimpleNamespace(
        fetch_query_revision=AsyncMock(return_value=revision_without_data),
    )

    resolved = await _resolve_query_revisions(
        queries_service=queries_service,
        project_id=uuid4(),
        query_revision_refs={"query-step": revision_ref},
    )

    assert resolved == {}, (
        "Revisions with null `data` must be skipped, not fabricated with empty data."
    )


@pytest.mark.asyncio
async def test_resolve_query_revisions_keeps_revision_with_real_data():
    from oss.src.core.evaluations.tasks.live import _resolve_query_revisions

    revision_id = uuid4()
    revision_ref = Reference(id=revision_id)

    revision_with_data = QueryRevision(
        id=revision_id,
        slug="my-query",
        data=QueryRevisionData(trace_ids=["00000000000000000000000000000001"]),
    )

    queries_service = SimpleNamespace(
        fetch_query_revision=AsyncMock(return_value=revision_with_data),
    )

    resolved = await _resolve_query_revisions(
        queries_service=queries_service,
        project_id=uuid4(),
        query_revision_refs={"query-step": revision_ref},
    )

    assert set(resolved.keys()) == {"query-step"}


@pytest.mark.asyncio
async def test_resolve_evaluator_revisions_skips_revision_with_null_data():
    """A live evaluation must not invoke an evaluator workflow with no config.

    If the evaluator revision row exists but `data` is null, downstream code
    would build a `WorkflowServiceRequest` with empty uri/url/script and call
    `workflows_service.invoke_workflow` against a non-functional target.
    """
    from oss.src.core.evaluations.tasks.live import _resolve_evaluator_revisions

    revision_id = uuid4()
    revision_ref = Reference(id=revision_id)

    revision_without_data = EvaluatorRevision(
        id=revision_id,
        slug="my-evaluator",
        data=None,
    )

    evaluators_service = SimpleNamespace(
        fetch_evaluator_revision=AsyncMock(return_value=revision_without_data),
    )

    resolved = await _resolve_evaluator_revisions(
        evaluators_service=evaluators_service,
        project_id=uuid4(),
        evaluator_revision_refs={"evaluator-step": revision_ref},
    )

    assert resolved == {}, (
        "Evaluator revisions with null `data` must be skipped, not fabricated with empty data."
    )


@pytest.mark.asyncio
async def test_resolve_evaluator_revisions_keeps_revision_with_real_data():
    from oss.src.core.evaluations.tasks.live import _resolve_evaluator_revisions

    revision_id = uuid4()
    revision_ref = Reference(id=revision_id)

    revision_with_data = EvaluatorRevision(
        id=revision_id,
        slug="my-evaluator",
        data=EvaluatorRevisionData(uri="http://evaluator.local/invoke"),
    )

    evaluators_service = SimpleNamespace(
        fetch_evaluator_revision=AsyncMock(return_value=revision_with_data),
    )

    resolved = await _resolve_evaluator_revisions(
        evaluators_service=evaluators_service,
        project_id=uuid4(),
        evaluator_revision_refs={"evaluator-step": revision_ref},
    )

    assert set(resolved.keys()) == {"evaluator-step"}
