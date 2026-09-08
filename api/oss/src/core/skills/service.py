from typing import Optional, Dict, Any, List
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from uuid import uuid4

from pydantic import ValidationError

from agenta.sdk.agents.skills.models import SkillTemplate
from agenta.sdk.engines.running.utils import AGENTA_BUILTIN_SKILL_URI

from oss.src.core.shared.dtos import Reference
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.skills.exceptions import (
    SkillContentInvalidError,
    SkillNotFoundError,
    SkillRevisionConflictError,
)
from oss.src.core.workflows.dtos import (
    SimpleWorkflowCreate,
    SimpleWorkflowData,
    SimpleWorkflowFlags,
    WorkflowRevision,
    WorkflowRevisionCommit,
    WorkflowRevisionData,
    WorkflowRevisionQuery,
    WorkflowRevisionQueryFlags,
)
from oss.src.core.workflows.service import (
    RevisionConflictError,
    WorkflowsService,
)
from oss.src.core.skills.dtos import (
    SkillCommitted,
    SkillCreated,
    SkillOriginInfo,
    SkillRevisionRow,
    SkillRegistryItem,
    SkillRegistryQuery,
    SkillRegistryList,
    SkillUsageItem,
    SkillUsageQuery,
)
from oss.src.core.skills.provenance import (
    effective_anchor_hash,
    origin_locator,
    read_origin,
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


def _is_skill_workflow(workflow) -> bool:
    """A skill IS a workflow, identified by its flag or the builtin skill URI."""
    flags = getattr(workflow, "flags", None)
    if flags is not None and bool(getattr(flags, "is_skill", False)):
        return True
    data = getattr(workflow, "data", None)
    uri = getattr(data, "uri", None)
    if uri is None and isinstance(data, dict):
        uri = data.get("uri")
    return uri == AGENTA_BUILTIN_SKILL_URI


def _head_hash(payload: Dict[str, Any]) -> str:
    # Local import avoids a service←import_service cycle for one pure function.
    from oss.src.core.skills.import_service import skill_content_hash

    return skill_content_hash(payload or None)


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
        simple_workflows_service=None,
    ):
        self.workflows_service = workflows_service
        # The one-call create used by the lifecycle facade (create → v1 commit).
        self.simple_workflows_service = simple_workflows_service

    async def _usage_counts(
        self, *, project_id: UUID
    ) -> tuple[Dict[str, int], Dict[str, int]]:
        """Per-skill embed counts across every agent's HEAD revision, keyed by the
        referenced workflow id and slug (one count per agent per skill)."""
        agent_heads = await self.workflows_service.query_workflow_head_revisions(
            project_id=project_id,
            #
            workflow_revision_query=WorkflowRevisionQuery(
                flags=WorkflowRevisionQueryFlags(is_agent=True),
            ),
        )

        by_id: Dict[str, int] = {}
        by_slug: Dict[str, int] = {}

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

            seen_ids: set = set()
            seen_slugs: set = set()
            for embed in find_object_embeds({"skills": skills}):
                references = embed.references or {}
                for key in ("workflow", "workflow_revision"):
                    ref = references.get(key)
                    if ref is None:
                        continue
                    if ref.id and str(ref.id) not in seen_ids:
                        seen_ids.add(str(ref.id))
                        by_id[str(ref.id)] = by_id.get(str(ref.id), 0) + 1
                    if ref.slug and ref.slug not in seen_slugs:
                        seen_slugs.add(ref.slug)
                        by_slug[ref.slug] = by_slug.get(ref.slug, 0) + 1

        return by_id, by_slug

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

        counts_by_id, counts_by_slug = await self._usage_counts(project_id=project_id)

        # One batched artifact fetch replaces the per-row lookups: names,
        # archive state, and import provenance all live on the artifact.
        artifact_ids = [r.artifact_id for r in head_revisions if r.artifact_id]
        workflows_by_id = {}
        if artifact_ids:
            artifacts = await self.workflows_service.query_workflows(
                project_id=project_id,
                workflow_refs=[
                    Reference(id=artifact_id) for artifact_id in artifact_ids
                ],
                include_archived=query.include_archived,
            )
            workflows_by_id = {str(a.id): a for a in artifacts}

        skills: List[SkillRegistryItem] = []

        for revision in head_revisions:
            workflow = workflows_by_id.get(str(revision.artifact_id))

            payload = _skill_payload(revision)
            files = payload.get("files")

            origin_info: Optional[SkillOriginInfo] = None
            origin = read_origin(getattr(workflow, "meta", None)) if workflow else None
            if origin is not None:
                locator = origin_locator(origin)
                checkpoint = origin.get("last_imported") or {}
                origin_info = SkillOriginInfo(
                    provider=origin.get("provider"),
                    repository=locator.get("repository"),
                    ref=locator.get("ref"),
                    path=locator.get("path"),
                    resolved_version=(
                        checkpoint.get("resolved_version")
                        if isinstance(checkpoint, dict)
                        else None
                    ),
                    imported_at_url=(
                        checkpoint.get("url") if isinstance(checkpoint, dict) else None
                    ),
                    # Derived, never stored: a head that hashes away from the
                    # anchor was edited locally (fails safe for any writer). The
                    # anchor reconciles against the head's own provenance, so a
                    # lost checkpoint write never shows as a local edit.
                    detached=_head_hash(payload)
                    != effective_anchor_hash(
                        origin,
                        head_content_hash=_head_hash(payload),
                        head_meta=revision.meta,
                    ),
                )

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
                    archived=bool(workflow and workflow.deleted_at),
                    skill_name=payload.get("name"),
                    skill_description=payload.get("description"),
                    files_count=len(files) if isinstance(files, list) else None,
                    used_by_count=(
                        counts_by_id.get(str(revision.artifact_id))
                        or counts_by_slug.get(revision.artifact_slug or "")
                        or 0
                    ),
                    origin=origin_info,
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

    # ─ lifecycle facade (plan: /skills owns every skill write) ────────────────

    @staticmethod
    def _validated_skill(skill: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """The server owns the content contract: every write validates against the
        SDK's SkillTemplate (the same rules the parser and runner enforce)."""
        try:
            template = SkillTemplate(**(skill or {}))
        except ValidationError as e:
            issue = e.errors()[0] if e.errors() else {}
            path = ".".join(str(part) for part in issue.get("loc", []))
            message = issue.get("msg", "Invalid skill.")
            raise SkillContentInvalidError(
                f"{path + ': ' if path else ''}{message}",
                next_step="Fix the skill content and retry.",
            ) from e
        return template.model_dump(mode="json", exclude_none=True)

    async def create_skill(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        skill: Dict[str, Any],
    ) -> SkillCreated:
        """Create a registry skill: the server generates the suffixed slug and
        stamps the invariants (flags on both records, the builtin skill URI)."""
        payload = self._validated_skill(skill)

        created = None
        for _ in range(3):
            try:
                created = await self.simple_workflows_service.create(
                    project_id=project_id,
                    user_id=user_id,
                    simple_workflow_create=SimpleWorkflowCreate(
                        # Display names may collide (like agents); the slug is
                        # plumbing and carries a random suffix.
                        slug=f"{payload['name']}-{uuid4().hex[:4]}",
                        name=payload["name"],
                        description=payload.get("description"),
                        flags=SimpleWorkflowFlags(is_skill=True, is_snippet=True),
                        data=SimpleWorkflowData(
                            uri=AGENTA_BUILTIN_SKILL_URI,
                            parameters={"skill": payload},
                        ),
                    ),
                )
            except EntityCreationConflict:
                continue
            break
        if not created or not created.id:
            raise SkillNotFoundError("The skill workflow could not be created.")
        return SkillCreated(
            workflow_id=str(created.id),
            slug=created.slug,
            revision_id=str(created.revision_id) if created.revision_id else None,
        )

    async def commit_skill_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_id: UUID,
        skill: Dict[str, Any],
        message: Optional[str] = None,
        base_revision_id: Optional[UUID] = None,
    ) -> SkillCommitted:
        """Commit a new revision of one skill, with the server stamping flags and
        URI; `base_revision_id` makes a concurrent edit a 409, never a clobber."""
        payload = self._validated_skill(skill)

        current = await self.simple_workflows_service.fetch(
            project_id=project_id,
            workflow_id=workflow_id,
        )
        if current is None:
            raise SkillNotFoundError(
                f"Skill workflow {workflow_id} was not found in this project.",
            )
        # The facade stamps skill flags and the skill URI, so committing through it
        # to a non-skill workflow would silently rewrite an agent (or evaluator) as
        # a skill. The target must already BE one.
        if not _is_skill_workflow(current):
            raise SkillNotFoundError(
                f"Workflow {workflow_id} is not a skill.",
                next_step="Commit non-skill workflows through the workflows API.",
            )

        try:
            outcome = await self.workflows_service.commit_workflow_revision_checked(
                project_id=project_id,
                user_id=user_id,
                workflow_revision_commit=WorkflowRevisionCommit(
                    slug=uuid4().hex[-12:],
                    name=payload["name"],
                    description=payload.get("description"),
                    message=message or None,
                    data=WorkflowRevisionData(
                        uri=AGENTA_BUILTIN_SKILL_URI,
                        parameters={"skill": payload},
                    ),
                    workflow_id=workflow_id,
                    workflow_variant_id=current.variant_id,
                    base_revision_id=base_revision_id,
                ),
            )
        except RevisionConflictError as e:
            raise SkillRevisionConflictError(
                "The skill changed while you were editing — reload and retry.",
                next_step="Fetch the head revision and rebase your edit onto it.",
                details={
                    "base_revision_id": str(e.base_revision_id),
                    "current_revision_id": str(e.current_revision_id),
                },
            ) from e

        revision = outcome.revision
        return SkillCommitted(
            workflow_id=str(workflow_id),
            revision_id=str(revision.id) if revision and revision.id else None,
            version=revision.version if revision else None,
        )

    async def archive_skill(
        self, *, project_id: UUID, user_id: UUID, workflow_id: UUID
    ):
        workflow = await self.workflows_service.archive_workflow(
            project_id=project_id, user_id=user_id, workflow_id=workflow_id
        )
        if workflow is None:
            raise SkillNotFoundError(
                f"Skill workflow {workflow_id} was not found in this project.",
            )
        return workflow

    async def unarchive_skill(
        self, *, project_id: UUID, user_id: UUID, workflow_id: UUID
    ):
        workflow = await self.workflows_service.unarchive_workflow(
            project_id=project_id, user_id=user_id, workflow_id=workflow_id
        )
        if workflow is None:
            raise SkillNotFoundError(
                f"Skill workflow {workflow_id} was not found in this project.",
            )
        return workflow

    async def log_skill_revisions(
        self, *, project_id: UUID, workflow_id: UUID
    ) -> List[SkillRevisionRow]:
        """The skill's history, newest first, with each revision's stored content.
        v0 (the empty bootstrap revision) is server-filtered — history starts at v1."""
        revisions = await self.workflows_service.query_workflow_revisions(
            project_id=project_id,
            workflow_refs=[Reference(id=workflow_id)],
        )
        rows: List[SkillRevisionRow] = []
        for revision in revisions:
            if str(revision.version or "") == "0":
                continue
            rows.append(
                SkillRevisionRow(
                    id=str(revision.id) if revision.id else None,
                    version=revision.version,
                    message=revision.message,
                    created_at=(
                        revision.created_at.isoformat() if revision.created_at else None
                    ),
                    workflow_variant_id=(
                        str(revision.variant_id) if revision.variant_id else None
                    ),
                    skill=_skill_payload(revision) or None,
                )
            )
        rows.sort(key=lambda row: int(row.version or 0), reverse=True)
        return rows

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
