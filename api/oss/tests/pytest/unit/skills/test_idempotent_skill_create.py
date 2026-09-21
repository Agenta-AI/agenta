from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.skills.exceptions import SkillContentInvalidError
from oss.src.core.skills.service import SkillsService
from oss.src.core.workflows.dtos import SimpleWorkflow, SimpleWorkflowCreateResult


PROJECT_ID = uuid4()
USER_ID = uuid4()
NAMESPACE = "agent-template-load"
REQUEST_KEY = "request-1"
FINGERPRINT = "sha256:" + "1" * 64
SKILL = {
    "name": "prospect-research",
    "description": "Research one prospect.",
    "body": "Find public evidence and cite it.",
}


class _SimpleWorkflows:
    def __init__(self):
        self.calls = []
        self.records = {}

    async def create_idempotent(self, **kwargs):
        self.calls.append(kwargs)
        component = kwargs["component"]
        key = (
            kwargs["project_id"],
            kwargs["namespace"],
            kwargs["request_key"],
            component,
        )
        planned_id = SkillsService.plan_idempotent_skill_ref(
            project_id=kwargs["project_id"],
            namespace=kwargs["namespace"],
            request_key=kwargs["request_key"],
            skill_name=kwargs["simple_workflow_create"].data.parameters["skill"][
                "name"
            ],
        )
        if key not in self.records:
            self.records[key] = SimpleWorkflow(
                id=planned_id.workflow_id,
                slug=planned_id.workflow_slug,
                variant_id=uuid4(),
                revision_id=uuid4(),
                data=kwargs["simple_workflow_create"].data,
            )
        return SimpleWorkflowCreateResult(
            workflow=self.records[key],
            replayed=len(
                [call for call in self.calls if call["component"] == component]
            )
            > 1,
        )


def _service():
    simple = _SimpleWorkflows()
    return (
        SkillsService(
            workflows_service=SimpleNamespace(static_catalog=None),
            simple_workflows_service=simple,
        ),
        simple,
    )


def test_plan_idempotent_skill_ref_is_stable_and_project_scoped():
    first = SkillsService.plan_idempotent_skill_ref(
        project_id=PROJECT_ID,
        namespace=NAMESPACE,
        request_key=REQUEST_KEY,
        skill_name=SKILL["name"],
    )
    again = SkillsService.plan_idempotent_skill_ref(
        project_id=PROJECT_ID,
        namespace=NAMESPACE,
        request_key=REQUEST_KEY,
        skill_name=SKILL["name"],
    )
    other = SkillsService.plan_idempotent_skill_ref(
        project_id=uuid4(),
        namespace=NAMESPACE,
        request_key=REQUEST_KEY,
        skill_name=SKILL["name"],
    )

    assert first == again
    assert first.workflow_id != other.workflow_id
    assert first.workflow_slug == f"{SKILL['name']}-{first.workflow_id.hex[:8]}"


@pytest.mark.asyncio
async def test_create_skill_idempotent_matches_the_planned_reference():
    service, simple = _service()
    planned = service.plan_idempotent_skill_ref(
        project_id=PROJECT_ID,
        namespace=NAMESPACE,
        request_key=REQUEST_KEY,
        skill_name=SKILL["name"],
    )

    first = await service.create_skill_idempotent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        namespace=NAMESPACE,
        request_key=REQUEST_KEY,
        request_fingerprint=FINGERPRINT,
        skill=SKILL,
    )
    replay = await service.create_skill_idempotent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        namespace=NAMESPACE,
        request_key=REQUEST_KEY,
        request_fingerprint=FINGERPRINT,
        skill=SKILL,
    )

    assert first.workflow_id == replay.workflow_id == str(planned.workflow_id)
    assert first.slug == replay.slug == planned.workflow_slug
    assert len(simple.records) == 1
    call = simple.calls[0]
    assert call["component"] == f"skill:{SKILL['name']}"
    assert call["request_fingerprint"] == FINGERPRINT
    assert call["simple_workflow_create"].flags.is_skill
    stored = call["simple_workflow_create"].data.parameters["skill"]
    assert {key: stored[key] for key in SKILL} == SKILL


@pytest.mark.asyncio
async def test_invalid_skill_is_rejected_before_workflow_creation():
    service, simple = _service()

    with pytest.raises(SkillContentInvalidError):
        await service.create_skill_idempotent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            namespace=NAMESPACE,
            request_key=REQUEST_KEY,
            request_fingerprint=FINGERPRINT,
            skill={"name": "Not Valid"},
        )

    assert not simple.calls
