"""What the commit endpoint answers when the commit does not simply succeed.

Every case here is a failure that used to reach the client as a 200, a 500, or a silent
`count: 0`. The endpoint carries no `suppress_exceptions`, so each of these is decided in
the handler or by the two decorators on it, and a missing decorator is a real regression:
`StaticWorkflowSlug` and `NonEmbeddableWorkflowReferenceError` are raised by the service
on the normal path.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.core.embeds.exceptions import NonEmbeddableWorkflowReferenceError
from oss.src.core.git.types import CommitLockTimeout
from oss.src.core.workflows.change_set import ChangeSetError, Reason
from oss.src.core.workflows.service import CommitOutcome, RevisionConflictError
from oss.src.core.workflows.types import StaticWorkflowSlug


VARIANT_ID = uuid4()


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(uuid4()),
            user_id=str(uuid4()),
        )
    )


def _commit_request(**data):
    from oss.src.apis.fastapi.workflows.models import WorkflowRevisionCommitRequest

    return WorkflowRevisionCommitRequest.model_validate(
        {
            "workflow_revision": {
                "workflow_variant_id": str(VARIANT_ID),
                "data": {"parameters": {"agent": {"instructions": "hi"}}},
                **data,
            }
        }
    )


def _revision():
    from oss.src.core.workflows.dtos import WorkflowRevision

    return WorkflowRevision(
        id=uuid4(),
        workflow_variant_id=VARIANT_ID,
        version="3",
    )


@pytest.fixture
def router():
    from oss.src.apis.fastapi.workflows.router import WorkflowsRouter

    return WorkflowsRouter(
        workflows_service=AsyncMock(),
        environments_service=AsyncMock(),
    )


@pytest.fixture
def allow_access():
    with patch(
        "oss.src.apis.fastapi.workflows.router.check_action_access",
        AsyncMock(return_value=True),
    ):
        yield


async def _commit(router, **kwargs):
    return await router.commit_workflow_revision(
        _request(),
        workflow_revision_commit_request=_commit_request(),
        **kwargs,
    )


def _delta_request(**delta):
    from oss.src.apis.fastapi.workflows.models import WorkflowRevisionCommitRequest

    return WorkflowRevisionCommitRequest.model_validate(
        {
            "workflow_revision": {
                "workflow_variant_id": str(VARIANT_ID),
                "base_revision_id": str(uuid4()),
                "delta": delta,
            }
        }
    )


class TestFailuresThatMustNotLookLikeSuccess:
    async def test_a_lock_timeout_answers_503_and_says_it_is_retryable(
        self, router, allow_access
    ):
        # Suppression in the DAO used to turn the timeout into `None`, which arrived as
        # `status="committed", count: 0`: a successful empty commit for a commit that
        # never happened.
        router.workflows_service.commit_workflow_revision_checked.side_effect = (
            CommitLockTimeout(variant_id=VARIANT_ID)
        )

        with pytest.raises(HTTPException) as caught:
            await _commit(router)

        assert caught.value.status_code == 503
        assert caught.value.detail["code"] == "commit_lock_timeout"
        assert caught.value.detail["retryable"] is True

    async def test_a_committed_status_with_no_revision_is_a_failure(
        self, router, allow_access
    ):
        # The backstop for every OTHER swallowed database error. Whatever the DAO lost, a
        # commit with nothing to show for it must not answer 200.
        router.workflows_service.commit_workflow_revision_checked.return_value = (
            CommitOutcome(revision=None, status="committed")
        )

        with patch(
            "oss.src.apis.fastapi.workflows.router.invalidate_cache", AsyncMock()
        ) as invalidate:
            with pytest.raises(HTTPException) as caught:
                await _commit(router)

        assert caught.value.status_code == 500
        assert caught.value.detail["code"] == "commit_failed"
        invalidate.assert_not_awaited()


class TestDomainRefusals:
    async def test_a_static_slug_is_a_client_error_not_a_crash(
        self, router, allow_access
    ):
        # Raised by `_reject_static_slug`, the first statement of the checked commit. It
        # only becomes a 4xx because `@handle_workflow_exceptions()` is on the route.
        router.workflows_service.commit_workflow_revision_checked.side_effect = (
            StaticWorkflowSlug("__ag__llm")
        )

        with pytest.raises(HTTPException) as caught:
            await _commit(router)

        assert 400 <= caught.value.status_code < 500

    async def test_a_non_embeddable_reference_answers_422_with_its_reason(
        self, router, allow_access
    ):
        router.workflows_service.commit_workflow_revision_checked.side_effect = (
            NonEmbeddableWorkflowReferenceError("__ag__llm")
        )

        with pytest.raises(HTTPException) as caught:
            await _commit(router)

        assert caught.value.status_code == 422
        assert caught.value.detail["code"] == "non_embeddable_reference"

    async def test_a_moved_head_answers_409_with_the_current_head(
        self, router, allow_access
    ):
        current = str(uuid4())
        router.workflows_service.commit_workflow_revision_checked.side_effect = (
            RevisionConflictError(
                base_revision_id=str(uuid4()),
                current_revision_id=current,
            )
        )

        with pytest.raises(HTTPException) as caught:
            await _commit(router)

        assert caught.value.status_code == 409
        assert caught.value.detail["current_revision_id"] == current

    async def test_a_change_set_refusal_answers_422(self, router, allow_access):
        router.workflows_service.commit_workflow_revision_checked.side_effect = (
            ChangeSetError(Reason.INVALID_DELTA, "both forms")
        )

        with pytest.raises(HTTPException) as caught:
            await _commit(router)

        assert caught.value.status_code == 422
        assert caught.value.detail["reason"]["code"] == Reason.INVALID_DELTA


class TestTheScopedAgentRoute:
    """The agent's write scope is a property of the ROUTE it is given.

    The model never holds the run's credential and never chooses the URL: the path comes
    from the server-side op catalog and the runner makes the call from outside the sandbox.
    So an agent cannot reach the unscoped route, and it cannot express a commit outside
    `parameters.agent`. The unscoped route keeps its behavior for humans and the SDK.
    """

    async def test_it_passes_the_agent_scope_to_the_service(self, router, allow_access):
        from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE

        router.workflows_service.commit_workflow_revision_checked.return_value = (
            CommitOutcome(revision=_revision(), status="committed")
        )

        with patch(
            "oss.src.apis.fastapi.workflows.router.invalidate_cache", AsyncMock()
        ):
            await router.commit_agent_workflow_revision(
                _request(),
                workflow_revision_commit_request=_delta_request(
                    set={"parameters": {"agent": {"instructions": "hi"}}}
                ),
            )

        call = router.workflows_service.commit_workflow_revision_checked.await_args
        assert call.kwargs["scope_policy"] is AGENT_COMMIT_SCOPE

    async def test_the_unscoped_route_passes_no_scope(self, router, allow_access):
        router.workflows_service.commit_workflow_revision_checked.return_value = (
            CommitOutcome(revision=_revision(), status="committed")
        )

        with patch(
            "oss.src.apis.fastapi.workflows.router.invalidate_cache", AsyncMock()
        ):
            await _commit(router)

        call = router.workflows_service.commit_workflow_revision_checked.await_args
        assert call.kwargs["scope_policy"] is None

    async def test_it_refuses_a_full_data_commit(self, router, allow_access):
        # A whole configuration carries every field the scope exists to protect, so the
        # scoped route refuses the shape instead of filtering it. The agent's tool only
        # ever sends a delta.
        with pytest.raises(HTTPException) as caught:
            await router.commit_agent_workflow_revision(
                _request(),
                workflow_revision_commit_request=_commit_request(),
            )

        assert caught.value.status_code == 422
        assert caught.value.detail["code"] == "full_data_not_committable"
        assert caught.value.detail["next_step"]
        router.workflows_service.commit_workflow_revision_checked.assert_not_awaited()

    async def test_the_unscoped_route_still_accepts_a_full_data_commit(
        self, router, allow_access
    ):
        router.workflows_service.commit_workflow_revision_checked.return_value = (
            CommitOutcome(revision=_revision(), status="committed")
        )

        with patch(
            "oss.src.apis.fastapi.workflows.router.invalidate_cache", AsyncMock()
        ):
            response = await _commit(router)

        assert response.status == "committed"

    async def test_the_scoped_route_keeps_the_committed_side_effects(
        self, router, allow_access
    ):
        # Same flow as the open route: the agent's commit must still evict the warm
        # session and refresh the playground, or the run would keep the stale config.
        router.workflows_service.commit_workflow_revision_checked.return_value = (
            CommitOutcome(revision=_revision(), status="committed")
        )

        with patch(
            "oss.src.apis.fastapi.workflows.router.invalidate_cache", AsyncMock()
        ) as invalidate:
            response = await router.commit_agent_workflow_revision(
                _request(),
                workflow_revision_commit_request=_delta_request(
                    set={"parameters": {"agent": {"instructions": "hi"}}}
                ),
            )

        assert response.count == 1
        invalidate.assert_awaited_once()


class TestSideEffects:
    async def test_no_change_evicts_nothing(self, router, allow_access):
        # A commit event throws away the warm sandbox. A commit that wrote no revision
        # must not pay that cost.
        router.workflows_service.commit_workflow_revision_checked.return_value = (
            CommitOutcome(
                revision=_revision(),
                status="no_change",
                warnings=[{"code": "no_change", "message": "nothing changed"}],
            )
        )

        with patch(
            "oss.src.apis.fastapi.workflows.router.invalidate_cache", AsyncMock()
        ) as invalidate:
            response = await _commit(router)

        assert response.status == "no_change"
        assert response.count == 1
        assert response.warnings[0].code == "no_change"
        invalidate.assert_not_awaited()

    async def test_a_real_commit_invalidates_the_cache(self, router, allow_access):
        router.workflows_service.commit_workflow_revision_checked.return_value = (
            CommitOutcome(revision=_revision(), status="committed")
        )

        with patch(
            "oss.src.apis.fastapi.workflows.router.invalidate_cache", AsyncMock()
        ) as invalidate:
            response = await _commit(router)

        assert response.status == "committed"
        assert response.count == 1
        invalidate.assert_awaited_once()
