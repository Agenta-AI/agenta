"""Registry listing: DB skills + the static built-ins block (WP-A2, Option C)."""

from uuid import uuid4

import pytest

from oss.src.core.skills.dtos import SkillRegistryQuery
from oss.src.core.skills.service import SkillsService, _skill_payload
from oss.src.core.workflows.dtos import (
    Workflow,
    WorkflowRevision,
    WorkflowRevisionData,
)
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog


def _head_revision(*, name: str, description: str, files: int) -> WorkflowRevision:
    return WorkflowRevision(
        id=uuid4(),
        workflow_id=uuid4(),
        workflow_variant_id=uuid4(),
        slug=name,
        version="3",
        message=f"update {name}",
        data=WorkflowRevisionData(
            uri="agenta:builtin:skill:v0",
            parameters={
                "skill": {
                    "name": name,
                    "description": description,
                    "body": "body",
                    "files": [
                        {"path": f"f{i}.md", "content": "x"} for i in range(files)
                    ],
                }
            },
        ),
    )


class _StubWorkflowsService:
    def __init__(self, *, revisions, workflows_by_id):
        self.static_catalog = StaticWorkflowCatalog()
        self._revisions = revisions
        self._workflows_by_id = workflows_by_id
        self.head_query_kwargs = None

    async def query_workflow_head_revisions(self, **kwargs):
        self.head_query_kwargs = kwargs
        return self._revisions

    async def fetch_workflow(self, *, project_id, workflow_ref, include_archived=None):
        return self._workflows_by_id.get(workflow_ref.id)


@pytest.mark.asyncio
async def test_registry_lists_db_skills_with_artifact_identity():
    revision = _head_revision(name="pdf-tools", description="fills PDFs", files=2)
    workflow = Workflow(
        id=revision.workflow_id,
        slug="pdf-tools",
        name="pdf-tools",
        description="Extract, split and fill PDF forms.",
    )
    revision.artifact_id = workflow.id

    service = SkillsService(
        workflows_service=_StubWorkflowsService(
            revisions=[revision],
            workflows_by_id={workflow.id: workflow},
        )
    )

    registry = await service.list_registry_skills(
        project_id=uuid4(),
        query=SkillRegistryQuery(search="pdf"),
    )

    assert len(registry.skills) == 1
    item = registry.skills[0]
    # artifact identity is authoritative for display
    assert item.name == "pdf-tools"
    assert item.description == "Extract, split and fill PDF forms."
    assert item.version == "3"
    assert item.files_count == 2
    assert item.id == revision.id  # pagination cursor rides the head revision
    assert item.is_static is False

    # the search term reaches the SQL-side artifact filter
    stub = service.workflows_service
    assert stub.head_query_kwargs["artifact_search"] == "pdf"
    assert stub.head_query_kwargs["workflow_revision_query"].flags.is_skill is True


@pytest.mark.asyncio
async def test_registry_builtin_block_holds_only_skill_entries():
    service = SkillsService(
        workflows_service=_StubWorkflowsService(revisions=[], workflows_by_id={})
    )

    registry = await service.list_registry_skills(project_id=uuid4())

    slugs = {item.workflow_slug for item in registry.builtin}
    # the two skill entries, and none of the tool / agent-config statics
    assert slugs == {
        "__ag__getting_started_with_agenta",
        "__ag__build_an_agent",
    }
    assert all(item.is_static for item in registry.builtin)
    assert all(item.skill_description for item in registry.builtin)


def test_skill_payload_tolerates_non_skill_data():
    assert _skill_payload(None) == {}
    revision = WorkflowRevision(
        id=uuid4(),
        workflow_id=uuid4(),
        workflow_variant_id=uuid4(),
        slug="not-a-skill",
        data=WorkflowRevisionData(parameters={"agent": {}}),
    )
    assert _skill_payload(revision) == {}
