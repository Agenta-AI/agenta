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
    SkillUsageItem,
    SkillUsageQuery,
)
from oss.src.core.embeds.utils import find_object_embeds

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

    async def get_skill_usage(
        self,
        *,
        project_id: UUID,
        #
        query: SkillUsageQuery,
    ) -> List[SkillUsageItem]:
        """Which agents embed this skill, and how (follow-latest vs pinned).

        Walks the HEAD revision of every agent in the project (bounded by
        agent count via the head-revision query, not total revisions) and
        classifies each matching embed by its reference level. Revision-level
        refs that carry only an opaque revision id (no artifact slug) are not
        matched in v1.
        """
        target_id = query.workflow_id
        target_slug = query.workflow_slug

        if target_id and not target_slug:
            workflow = await self.workflows_service.fetch_workflow(
                project_id=project_id,
                workflow_ref=Reference(id=target_id),
            )
            target_slug = workflow.slug if workflow else None

        agent_heads = await self.workflows_service.query_workflow_head_revisions(
            project_id=project_id,
            #
            workflow_revision_query=WorkflowRevisionQuery(
                flags=WorkflowRevisionQueryFlags(is_agent=True),
            ),
        )

        def _matches(reference) -> bool:
            if reference is None:
                return False
            if target_id and reference.id and str(reference.id) == str(target_id):
                return True
            if target_slug and reference.slug and reference.slug == target_slug:
                return True
            return False

        usage: List[SkillUsageItem] = []

        for head in agent_heads:
            parameters = None
            if head.data is not None:
                parameters = getattr(head.data, "parameters", None)
                if parameters is None and isinstance(head.data, dict):
                    parameters = head.data.get("parameters")
            if not isinstance(parameters, dict):
                continue

            agent = parameters.get("agent")
            skills = agent.get("skills") if isinstance(agent, dict) else None
            if not isinstance(skills, list):
                continue

            item: Optional[SkillUsageItem] = None

            for embed in find_object_embeds({"skills": skills}):
                references = embed.references or {}

                revision_ref = references.get("workflow_revision")
                if revision_ref is not None and _matches(revision_ref):
                    item = SkillUsageItem(
                        agent_workflow_id=head.artifact_id,
                        agent_slug=head.artifact_slug,
                        mode="pinned",
                        pinned_version=(
                            str(revision_ref.version)
                            if getattr(revision_ref, "version", None) is not None
                            else None
                        ),
                    )
                    break

                workflow_ref = references.get("workflow")
                if workflow_ref is not None and _matches(workflow_ref):
                    item = SkillUsageItem(
                        agent_workflow_id=head.artifact_id,
                        agent_slug=head.artifact_slug,
                        mode="latest",
                    )
                    break

            if item is None:
                continue

            if head.artifact_id:
                workflow = await self.workflows_service.fetch_workflow(
                    project_id=project_id,
                    workflow_ref=Reference(id=head.artifact_id),
                )
                if workflow:
                    item.agent_name = workflow.name or workflow.slug
                    item.agent_slug = item.agent_slug or workflow.slug

            usage.append(item)

        return usage

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
