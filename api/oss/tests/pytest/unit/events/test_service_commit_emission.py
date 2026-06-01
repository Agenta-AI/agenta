"""Unit tests for service-layer commit-event emission.

Verifies that calling `commit_*_revision(...)` on each domain service emits
exactly one `*.revisions.committed` event, regardless of whether the caller
is a direct commit route or a higher-level path (simple-service create/edit,
deploy, defaults seeding, etc.).

These tests mock the DAO/workflow-service boundary so they do not need a DB
or redis connection. They patch `publish_event` to capture envelopes.
"""

from types import SimpleNamespace
from typing import Any, List
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest

from oss.src.core.events.types import EventType


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _captured_publishes(captured: List[dict]):
    async def _capture(**kwargs):
        captured.append(kwargs)
        return True

    return _capture


def _make_revision(
    *,
    artifact_id: UUID,
    variant_id: UUID,
    revision_id: UUID,
    slug: str = "v1",
    version: str = "v1",
    artifact_slug: str = "artifact-slug",
    variant_slug: str = "variant-slug",
) -> Any:
    # Mirrors what the git DAO now returns: the revision's own slug plus the
    # parent artifact/variant slugs it resolves via eager-loaded relationships.
    return SimpleNamespace(
        id=revision_id,
        slug=slug,
        version=version,
        artifact_id=artifact_id,
        variant_id=variant_id,
        artifact_slug=artifact_slug,
        variant_slug=variant_slug,
        model_dump=lambda **_: {
            "id": str(revision_id),
            "slug": slug,
            "version": version,
            "artifact_id": str(artifact_id),
            "variant_id": str(variant_id),
            "artifact_slug": artifact_slug,
            "variant_slug": variant_slug,
        },
    )


# ---------------------------------------------------------------------------
# Applications — commit_application_revision delegates to WorkflowsService
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_applications_service_commit_emits_event_once():
    from oss.src.core.applications.dtos import ApplicationRevisionCommit
    from oss.src.core.applications.service import ApplicationsService

    project_id = uuid4()
    user_id = uuid4()
    revision_id = uuid4()
    artifact_id = uuid4()
    variant_id = uuid4()

    workflows_service = SimpleNamespace(
        commit_workflow_revision=AsyncMock(
            return_value=_make_revision(
                artifact_id=artifact_id,
                variant_id=variant_id,
                revision_id=revision_id,
                slug="v4",
                version="v4",
            )
        )
    )
    svc = ApplicationsService.__new__(ApplicationsService)
    svc.workflows_service = workflows_service

    commit = ApplicationRevisionCommit(
        slug="v4",
        message="Commit changes",
        application_id=artifact_id,
        application_variant_id=variant_id,
    )

    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        result = await svc.commit_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_commit=commit,
        )

    assert result is not None
    assert len(captured) == 1
    msg = captured[0]
    assert msg["project_id"] == project_id
    event = msg["event"]
    # Applications now emit as workflow events (domain="workflow")
    assert event.event_type == EventType.WORKFLOWS_REVISIONS_COMMITTED
    assert event.attributes["user_id"] == str(user_id)
    assert event.attributes["message"] == "Commit changes"
    refs = event.attributes["references"]
    assert refs["workflow"] == {"id": str(artifact_id), "slug": "artifact-slug"}
    assert refs["workflow_variant"] == {
        "id": str(variant_id),
        "slug": "variant-slug",
    }
    assert refs["workflow_revision"]["id"] == str(revision_id)


# ---------------------------------------------------------------------------
# Queries — commit_query_revision calls queries_dao.commit_revision
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_queries_service_commit_emits_event_once():
    from oss.src.core.queries.dtos import QueryRevisionCommit
    from oss.src.core.queries.service import QueriesService

    project_id = uuid4()
    user_id = uuid4()
    revision_id = uuid4()
    artifact_id = uuid4()
    variant_id = uuid4()

    queries_dao = SimpleNamespace(
        commit_revision=AsyncMock(
            return_value=_make_revision(
                artifact_id=artifact_id,
                variant_id=variant_id,
                revision_id=revision_id,
                slug="v3",
                version="v3",
            )
        )
    )
    svc = QueriesService.__new__(QueriesService)
    svc.queries_dao = queries_dao

    commit = QueryRevisionCommit(
        slug="v3",
        message="Commit query",
        query_id=artifact_id,
        query_variant_id=variant_id,
    )

    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        result = await svc.commit_query_revision(
            project_id=project_id,
            user_id=user_id,
            query_revision_commit=commit,
        )

    assert result is not None
    assert len(captured) == 1
    event = captured[0]["event"]
    assert event.event_type == EventType.QUERIES_REVISIONS_COMMITTED
    assert event.attributes["message"] == "Commit query"
    refs = event.attributes["references"]
    assert refs["query"] == {"id": str(artifact_id), "slug": "artifact-slug"}
    assert refs["query_variant"] == {"id": str(variant_id), "slug": "variant-slug"}
    assert refs["query_revision"]["id"] == str(revision_id)


# ---------------------------------------------------------------------------
# Testsets — commit_testset_revision calls testsets_dao.commit_revision
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_testsets_service_commit_emits_event_once():
    from oss.src.core.testsets.dtos import TestsetRevisionCommit, TestsetRevisionData
    from oss.src.core.testsets.service import TestsetsService

    project_id = uuid4()
    user_id = uuid4()
    revision_id = uuid4()
    artifact_id = uuid4()
    variant_id = uuid4()

    testsets_dao = SimpleNamespace(
        commit_revision=AsyncMock(
            return_value=_make_revision(
                artifact_id=artifact_id,
                variant_id=variant_id,
                revision_id=revision_id,
                slug="v5",
                version="v5",
            )
        )
    )
    svc = TestsetsService.__new__(TestsetsService)
    svc.testsets_dao = testsets_dao
    # _populate_testcases is a no-op when nothing to populate
    svc._populate_testcases = AsyncMock(return_value=None)

    commit = TestsetRevisionCommit(
        slug="v5",
        message="Commit testset",
        testset_id=artifact_id,
        testset_variant_id=variant_id,
        data=TestsetRevisionData(testcase_ids=[]),
    )

    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        result = await svc.commit_testset_revision(
            project_id=project_id,
            user_id=user_id,
            testset_revision_commit=commit,
        )

    assert result is not None
    assert len(captured) == 1
    event = captured[0]["event"]
    assert event.event_type == EventType.TESTSETS_REVISIONS_COMMITTED
    assert event.attributes["message"] == "Commit testset"
    refs = event.attributes["references"]
    assert refs["testset"] == {"id": str(artifact_id), "slug": "artifact-slug"}
    assert refs["testset_variant"] == {"id": str(variant_id), "slug": "variant-slug"}
    assert refs["testset_revision"]["id"] == str(revision_id)


# ---------------------------------------------------------------------------
# Evaluators — commit_evaluator_revision delegates to WorkflowsService
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_evaluators_service_commit_emits_event_once():
    from oss.src.core.evaluators.dtos import EvaluatorRevisionCommit
    from oss.src.core.evaluators.service import EvaluatorsService

    project_id = uuid4()
    user_id = uuid4()
    revision_id = uuid4()
    artifact_id = uuid4()
    variant_id = uuid4()

    workflows_service = SimpleNamespace(
        commit_workflow_revision=AsyncMock(
            return_value=_make_revision(
                artifact_id=artifact_id,
                variant_id=variant_id,
                revision_id=revision_id,
                slug="v2",
                version="v2",
            )
        )
    )
    svc = EvaluatorsService.__new__(EvaluatorsService)
    svc.workflows_service = workflows_service

    commit = EvaluatorRevisionCommit(
        slug="v2",
        message="Commit eval",
        evaluator_id=artifact_id,
        evaluator_variant_id=variant_id,
    )

    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        result = await svc.commit_evaluator_revision(
            project_id=project_id,
            user_id=user_id,
            evaluator_revision_commit=commit,
        )

    assert result is not None
    assert len(captured) == 1
    event = captured[0]["event"]
    # Evaluators now emit as workflow events (domain="workflow")
    assert event.event_type == EventType.WORKFLOWS_REVISIONS_COMMITTED
    assert event.attributes["message"] == "Commit eval"
    refs = event.attributes["references"]
    assert refs["workflow"] == {"id": str(artifact_id), "slug": "artifact-slug"}
    assert refs["workflow_variant"] == {
        "id": str(variant_id),
        "slug": "variant-slug",
    }
    assert refs["workflow_revision"]["id"] == str(revision_id)


# ---------------------------------------------------------------------------
# Environments — commit_environment_revision preserves state + diff + message
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_environments_service_commit_emits_event_with_state_and_diff():
    from oss.src.core.environments.dtos import (
        EnvironmentRevisionCommit,
        EnvironmentRevisionData,
    )
    from oss.src.core.environments.service import EnvironmentsService

    project_id = uuid4()
    user_id = uuid4()
    revision_id = uuid4()
    artifact_id = uuid4()
    variant_id = uuid4()

    environments_dao = SimpleNamespace(
        commit_revision=AsyncMock(
            return_value=_make_revision(
                artifact_id=artifact_id,
                variant_id=variant_id,
                revision_id=revision_id,
                slug="v6",
                version="v6",
            )
        )
    )
    # commit_environment_revision also reads previous references via
    # _get_previous_environment_references → query_environment_revisions.
    svc = EnvironmentsService.__new__(EnvironmentsService)
    svc.environments_dao = environments_dao
    svc.embeds_service = None
    svc._get_previous_environment_references = AsyncMock(return_value={})

    commit = EnvironmentRevisionCommit(
        slug="v6",
        message="Promote prompt changes",
        environment_id=artifact_id,
        environment_variant_id=variant_id,
        data=EnvironmentRevisionData(references={}),
    )

    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        result = await svc.commit_environment_revision(
            project_id=project_id,
            user_id=user_id,
            environment_revision_commit=commit,
        )

    assert result is not None
    assert len(captured) == 1
    event = captured[0]["event"]
    assert event.event_type == EventType.ENVIRONMENTS_REVISIONS_COMMITTED
    assert event.attributes["user_id"] == str(user_id)
    assert event.attributes["message"] == "Promote prompt changes"
    refs = event.attributes["references"]
    assert refs["environment"] == {"id": str(artifact_id), "slug": "artifact-slug"}
    assert refs["environment_variant"] == {
        "id": str(variant_id),
        "slug": "variant-slug",
    }
    assert refs["environment_revision"]["id"] == str(revision_id)
    # Legacy attributes preserved.
    assert "state" in event.attributes
    assert event.attributes["diff"] == {
        "created": {},
        "updated": {},
        "deleted": {},
    }


@pytest.mark.asyncio
async def test_environments_service_delta_commit_emits_event_once():
    from oss.src.core.environments.dtos import (
        EnvironmentRevisionCommit,
        EnvironmentRevisionData,
        EnvironmentRevisionDelta,
    )
    from oss.src.core.environments.service import EnvironmentsService
    from oss.src.core.shared.dtos import Reference

    project_id = uuid4()
    user_id = uuid4()
    revision_id = uuid4()
    artifact_id = uuid4()
    variant_id = uuid4()
    app_revision_id = uuid4()

    environments_dao = SimpleNamespace(
        commit_revision=AsyncMock(
            return_value=_make_revision(
                artifact_id=artifact_id,
                variant_id=variant_id,
                revision_id=revision_id,
                slug="v7",
                version="v7",
            )
        )
    )

    svc = EnvironmentsService.__new__(EnvironmentsService)
    svc.environments_dao = environments_dao
    svc.embeds_service = None
    svc.query_environment_revisions = AsyncMock(
        return_value=[
            SimpleNamespace(
                data=EnvironmentRevisionData(
                    references={
                        "app": {
                            "application_revision": Reference(id=uuid4()),
                        }
                    }
                )
            )
        ]
    )
    svc._get_previous_environment_references = AsyncMock(return_value={})

    commit = EnvironmentRevisionCommit(
        slug="v7",
        message="Delta commit",
        environment_id=artifact_id,
        environment_variant_id=variant_id,
        delta=EnvironmentRevisionDelta(
            set={
                "app": {
                    "application_revision": Reference(id=app_revision_id),
                }
            }
        ),
    )

    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        result = await svc.commit_environment_revision(
            project_id=project_id,
            user_id=user_id,
            environment_revision_commit=commit,
        )

    assert result is not None
    assert environments_dao.commit_revision.await_count == 1
    assert len(captured) == 1
    assert captured[0]["event"].event_type == EventType.ENVIRONMENTS_REVISIONS_COMMITTED


@pytest.mark.asyncio
async def test_testsets_service_delta_commit_emits_event_once():
    from oss.src.core.testcases.dtos import Testcase
    from oss.src.core.testsets.dtos import (
        TestsetRevisionCommit,
        TestsetRevisionData,
        TestsetRevisionDelta,
        TestsetRevisionDeltaColumns,
    )
    from oss.src.core.testsets.service import TestsetsService

    project_id = uuid4()
    user_id = uuid4()
    revision_id = uuid4()
    artifact_id = uuid4()
    variant_id = uuid4()

    testsets_dao = SimpleNamespace(
        commit_revision=AsyncMock(
            return_value=_make_revision(
                artifact_id=artifact_id,
                variant_id=variant_id,
                revision_id=revision_id,
                slug="v8",
                version="v8",
            )
        )
    )

    svc = TestsetsService.__new__(TestsetsService)
    svc.testsets_dao = testsets_dao
    svc.testcases_service = SimpleNamespace(
        create_testcases=AsyncMock(
            return_value=[
                Testcase(id=uuid4(), set_id=artifact_id, data={"prompt": "hello"})
            ]
        )
    )
    svc.fetch_testset_revision = AsyncMock(
        return_value=SimpleNamespace(
            testset_variant_id=variant_id,
            description="Base revision",
            data=TestsetRevisionData(
                testcases=[
                    Testcase(id=uuid4(), set_id=artifact_id, data={"prompt": "hello"})
                ]
            ),
        )
    )
    svc._populate_testcases = AsyncMock(return_value=None)

    commit = TestsetRevisionCommit(
        message="Delta testset",
        testset_id=artifact_id,
        delta=TestsetRevisionDelta(
            columns=TestsetRevisionDeltaColumns(add=["expected"])
        ),
    )

    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        result = await svc.commit_testset_revision(
            project_id=project_id,
            user_id=user_id,
            testset_revision_commit=commit,
        )

    assert result is not None
    assert testsets_dao.commit_revision.await_count == 1
    assert len(captured) == 1
    assert captured[0]["event"].event_type == EventType.TESTSETS_REVISIONS_COMMITTED


# ---------------------------------------------------------------------------
# DAO returns None → no event published
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_queries_service_commit_no_revision_no_event():
    from oss.src.core.queries.dtos import QueryRevisionCommit
    from oss.src.core.queries.service import QueriesService

    project_id = uuid4()
    user_id = uuid4()
    artifact_id = uuid4()
    variant_id = uuid4()

    queries_dao = SimpleNamespace(commit_revision=AsyncMock(return_value=None))
    svc = QueriesService.__new__(QueriesService)
    svc.queries_dao = queries_dao

    commit = QueryRevisionCommit(
        slug="v1",
        query_id=artifact_id,
        query_variant_id=variant_id,
    )

    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        result = await svc.commit_query_revision(
            project_id=project_id,
            user_id=user_id,
            query_revision_commit=commit,
        )

    assert result is None
    assert captured == []
