"""An embed whose redundant refs name two different workflows.

A skill entry `{"workflow": {"slug": A, "id": <B's id>}}` resolves by id to B, then fails the
consistency check. At run time that refusal must name the entry; at commit time the entry
must not be stored at all.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from oss.src.core.embeds.service import EmbedsService
from oss.src.core.git.types import RetrieveRefsInconsistent
from oss.src.core.workflows.dtos import (
    Workflow,
    WorkflowRevision,
    WorkflowRevisionCommit,
    WorkflowRevisionData,
    WorkflowVariant,
)
from oss.src.core.workflows.service import WorkflowsService


_NAMED_SLUG = "agenta-brand-visual"
_ACTUAL_SLUG = "linkedin-post-writer"


def _skill_entry(*, workflow_id):
    return {
        "@ag.embed": {
            "@ag.references": {
                "workflow": {"slug": _NAMED_SLUG, "id": str(workflow_id)},
            },
            "@ag.selector": {"path": "parameters.skill"},
        },
        "name": "Agenta brand visual",
    }


def _agent_data(*, workflow_id):
    return WorkflowRevisionData(
        parameters={"agent": {"skills": [_skill_entry(workflow_id=workflow_id)]}}
    )


def _service_with_other_workflow():
    """A DAO whose workflow with the embed's id carries a different slug."""
    workflow_id, variant_id = uuid4(), uuid4()
    workflows_dao = AsyncMock()
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=workflow_id, slug=_ACTUAL_SLUG
    )
    workflows_dao.fetch_variant.return_value = WorkflowVariant(
        id=variant_id, slug=f"{_ACTUAL_SLUG}.default", workflow_id=workflow_id
    )
    workflows_dao.fetch_revision.return_value = WorkflowRevision(
        id=uuid4(),
        slug="rev",
        version="3",
        workflow_id=workflow_id,
        workflow_variant_id=variant_id,
        artifact_id=workflow_id,
        artifact_slug=_ACTUAL_SLUG,
        variant_id=variant_id,
        variant_slug=f"{_ACTUAL_SLUG}.default",
        data=WorkflowRevisionData(parameters={"skill": {"name": "x"}}),
    )
    service = WorkflowsService(workflows_dao=workflows_dao)
    service.embeds_service = EmbedsService(workflows_service=service)
    return service, workflows_dao, workflow_id


@pytest.mark.asyncio
async def test_run_time_refusal_names_the_broken_entry():
    service, _, workflow_id = _service_with_other_workflow()
    revision = WorkflowRevision(
        id=uuid4(),
        workflow_id=uuid4(),
        workflow_variant_id=uuid4(),
        slug="agent-config",
        data=_agent_data(workflow_id=workflow_id),
    )

    with (
        patch(
            "oss.src.core.embeds.service.embedded_agent_visible",
            AsyncMock(return_value=True),
        ),
        pytest.raises(RetrieveRefsInconsistent) as caught,
    ):
        await service.resolve_workflow_revision(
            project_id=uuid4(), workflow_revision=revision
        )

    assert _NAMED_SLUG in caught.value.message
    # The resolved workflow may be one the caller cannot read.
    assert _ACTUAL_SLUG not in caught.value.message
    assert "add it again" in caught.value.message


@pytest.mark.asyncio
async def test_commit_rejects_an_inconsistent_embed_before_persisting():
    service, workflows_dao, workflow_id = _service_with_other_workflow()

    # The git refusal, so every route keeps answering 400 for it.
    with pytest.raises(RetrieveRefsInconsistent) as caught:
        await service.commit_workflow_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=WorkflowRevisionCommit(
                workflow_id=uuid4(),
                workflow_variant_id=uuid4(),
                slug="agent-config",
                data=_agent_data(workflow_id=workflow_id),
            ),
            emit=False,
        )

    assert _NAMED_SLUG in caught.value.message
    workflows_dao.commit_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_commit_skips_the_lookup_for_a_single_identifier():
    service, workflows_dao, _ = _service_with_other_workflow()
    workflows_dao.commit_revision.return_value = None
    data = WorkflowRevisionData(
        parameters={
            "agent": {
                "skills": [
                    {
                        "@ag.embed": {
                            "@ag.references": {"workflow": {"slug": _NAMED_SLUG}},
                            "@ag.selector": {"path": "parameters.skill"},
                        }
                    }
                ]
            }
        }
    )

    await service.commit_workflow_revision(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_revision_commit=WorkflowRevisionCommit(
            workflow_id=uuid4(),
            workflow_variant_id=uuid4(),
            slug="agent-config",
            data=data,
        ),
        emit=False,
    )

    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.commit_revision.assert_awaited_once()
