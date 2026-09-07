"""The /skills lifecycle facade (create / commit / log): the server owns the
invariants the frontend used to hand-roll — SkillTemplate validation, flag and
URI stamping, generated slugs, optimistic concurrency."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.skills.exceptions import (
    SkillContentInvalidError,
    SkillRevisionConflictError,
)
from oss.src.core.skills.service import SkillsService
from oss.src.core.workflows.service import RevisionConflictError

PROJECT_ID = uuid4()
USER_ID = uuid4()

SKILL = {
    "name": "weather-report",
    "description": "Fetches the weather for a city.",
    "body": "Report the weather.",
}


class _StubWorkflowsService:
    def __init__(self):
        self.static_catalog = None
        self.commits = []
        self.conflict_next_commit = False
        self.revisions = []

    async def commit_workflow_revision_checked(
        self, *, project_id, user_id, workflow_revision_commit, platform_meta=False
    ):
        if self.conflict_next_commit:
            self.conflict_next_commit = False
            raise RevisionConflictError(
                base_revision_id=uuid4(), current_revision_id=uuid4()
            )
        self.commits.append(workflow_revision_commit)
        return SimpleNamespace(
            revision=SimpleNamespace(id=uuid4(), version="2"),
            status="committed",
            warnings=[],
        )

    async def query_workflow_revisions(self, *, project_id, workflow_refs):
        return self.revisions


class _StubSimpleWorkflowsService:
    def __init__(self, *, reject_creates: int = 0):
        self.workflows_service = _StubWorkflowsService()
        self.created = []
        self._reject = reject_creates
        self.head = SimpleNamespace(variant_id=uuid4(), revision_id=uuid4())

    async def create(
        self, *, project_id, user_id, simple_workflow_create, platform_meta=False
    ):
        if self._reject > 0:
            self._reject -= 1
            from oss.src.core.shared.exceptions import EntityCreationConflict

            raise EntityCreationConflict("slug taken")
        self.created.append(simple_workflow_create)
        return SimpleNamespace(
            id=uuid4(), slug=simple_workflow_create.slug, revision_id=uuid4()
        )

    async def fetch(self, *, project_id, workflow_id):
        return self.head


def _service(**kwargs):
    simple = _StubSimpleWorkflowsService(**kwargs)
    service = SkillsService(
        workflows_service=simple.workflows_service,
        simple_workflows_service=simple,
    )
    return service, simple


# --- create -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_stamps_invariants_and_generates_the_slug():
    service, simple = _service()
    created = await service.create_skill(
        project_id=PROJECT_ID, user_id=USER_ID, skill=SKILL
    )

    call = simple.created[0]
    assert call.slug.startswith("weather-report-") and len(call.slug) > len(
        "weather-report-"
    )
    assert call.flags.is_skill and call.flags.is_snippet
    assert call.data.uri == "agenta:builtin:skill:v0"
    assert call.data.parameters["skill"]["name"] == "weather-report"
    assert created["slug"] == call.slug
    assert created["workflow_id"]


@pytest.mark.asyncio
async def test_create_rejects_invalid_content():
    service, simple = _service()
    with pytest.raises(SkillContentInvalidError):
        await service.create_skill(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            skill={**SKILL, "name": "Not A Valid Name"},
        )
    assert not simple.created


@pytest.mark.asyncio
async def test_create_retries_a_slug_collision():
    service, simple = _service(reject_creates=1)
    created = await service.create_skill(
        project_id=PROJECT_ID, user_id=USER_ID, skill=SKILL
    )
    assert created["workflow_id"]
    assert len(simple.created) == 1


# --- commit -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_commit_stamps_invariants_and_threads_the_base():
    service, simple = _service()
    base = uuid4()
    workflow_id = uuid4()
    outcome = await service.commit_skill_revision(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_id=workflow_id,
        skill=SKILL,
        message="edit",
        base_revision_id=base,
    )

    commit = simple.workflows_service.commits[0]
    assert commit.data.uri == "agenta:builtin:skill:v0"
    assert commit.base_revision_id == base
    assert commit.workflow_variant_id == simple.head.variant_id
    assert outcome["version"] == "2"


@pytest.mark.asyncio
async def test_commit_conflict_maps_to_the_domain_error():
    service, simple = _service()
    simple.workflows_service.conflict_next_commit = True
    with pytest.raises(SkillRevisionConflictError) as err:
        await service.commit_skill_revision(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            workflow_id=uuid4(),
            skill=SKILL,
        )
    assert "current_revision_id" in err.value.details


@pytest.mark.asyncio
async def test_commit_rejects_invalid_content_before_touching_anything():
    service, simple = _service()
    with pytest.raises(SkillContentInvalidError):
        await service.commit_skill_revision(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            workflow_id=uuid4(),
            skill={"name": "x"},  # description/body missing
        )
    assert not simple.workflows_service.commits


# --- revisions log ------------------------------------------------------------


@pytest.mark.asyncio
async def test_log_filters_v0_sorts_desc_and_extracts_content():
    service, simple = _service()

    def _rev(version, name):
        return SimpleNamespace(
            id=uuid4(),
            version=version,
            message=f"m{version}",
            created_at=None,
            variant_id=uuid4(),
            data=SimpleNamespace(parameters={"skill": {"name": name}}),
        )

    simple.workflows_service.revisions = [
        _rev("0", "boot"),
        _rev("1", "a"),
        _rev("2", "b"),
    ]
    rows = await service.log_skill_revisions(project_id=PROJECT_ID, workflow_id=uuid4())
    assert [r["version"] for r in rows] == ["2", "1"]
    assert rows[0]["skill"] == {"name": "b"}
