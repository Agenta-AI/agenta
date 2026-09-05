from typing import Optional, Dict, Any, List
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import (
    WorkflowRevision,
    WorkflowRevisionQuery,
    WorkflowRevisionQueryFlags,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.skills.dtos import (
    SkillRegistryItem,
    SkillRegistryQuery,
    SkillRegistryList,
)

log = get_module_logger(__name__)


def _skill_payload(revision: Optional[WorkflowRevision]) -> Dict[str, Any]:
    if not revision or not revision.data:
        return {}

    data = revision.data
    parameters = getattr(data, "parameters", None)
    if parameters is None and isinstance(data, dict):
        parameters = data.get("parameters")
    if not isinstance(parameters, dict):
        return {}

    skill = parameters.get("skill")
    return skill if isinstance(skill, dict) else {}


class SkillsService:
    """Registry-facing read model over skill workflows.

    A skill IS a workflow (revision flag `is_skill`); this service only
    exposes correct listing on top of the head-revision query, plus the
    code-defined built-ins as a separate block.
    """

    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
    ):
        self.workflows_service = workflows_service

    async def list_registry_skills(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SkillRegistryQuery] = None,
    ) -> SkillRegistryList:
        query = query or SkillRegistryQuery()

        head_revisions = await self.workflows_service.query_workflow_head_revisions(
            project_id=project_id,
            #
            workflow_revision_query=WorkflowRevisionQuery(
                flags=WorkflowRevisionQueryFlags(is_skill=True),
            ),
            #
            artifact_search=query.search,
            #
            include_archived=query.include_archived,
            #
            windowing=query.windowing,
        )

        skills: List[SkillRegistryItem] = []

        for revision in head_revisions:
            workflow = None
            if revision.artifact_id:
                workflow = await self.workflows_service.fetch_workflow(
                    project_id=project_id,
                    workflow_ref=Reference(id=revision.artifact_id),
                    include_archived=query.include_archived,
                )

            payload = _skill_payload(revision)
            files = payload.get("files")

            skills.append(
                SkillRegistryItem(
                    id=revision.id,
                    workflow_id=revision.artifact_id,
                    workflow_slug=revision.artifact_slug
                    or (workflow.slug if workflow else None),
                    name=(workflow.name if workflow else None)
                    or payload.get("name")
                    or revision.artifact_slug,
                    description=(workflow.description if workflow else None)
                    or payload.get("description"),
                    head_revision_id=revision.id,
                    version=revision.version,
                    message=revision.message,
                    created_at=revision.created_at,
                    updated_at=revision.updated_at or revision.created_at,
                    is_static=False,
                    skill_name=payload.get("name"),
                    skill_description=payload.get("description"),
                    files_count=len(files) if isinstance(files, list) else None,
                )
            )

        builtin = self._list_builtin_skills()

        return SkillRegistryList(
            skills=skills,
            builtin=builtin,
            windowing=query.windowing,
        )

    def _list_builtin_skills(self) -> List[SkillRegistryItem]:
        catalog = self.workflows_service.static_catalog
        if not catalog:
            return []

        items: List[SkillRegistryItem] = []

        for slug in catalog.list_slugs():
            revision = catalog.retrieve_revision(slug=slug)
            if not revision:
                continue

            flags = revision.flags
            is_skill = bool(getattr(flags, "is_skill", None)) if flags else False
            if not is_skill:
                continue

            payload = _skill_payload(revision)
            files = payload.get("files")

            items.append(
                SkillRegistryItem(
                    id=revision.id,
                    workflow_id=revision.artifact_id,
                    workflow_slug=slug,
                    name=payload.get("name") or slug,
                    description=payload.get("description"),
                    head_revision_id=revision.id,
                    version=revision.version,
                    message=revision.message,
                    is_static=True,
                    skill_name=payload.get("name"),
                    skill_description=payload.get("description"),
                    files_count=len(files) if isinstance(files, list) else None,
                )
            )

        return items
