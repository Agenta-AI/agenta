from typing import Any
from uuid import UUID

from oss.src.core.agent_templates.bindings import TemplateBindingResolver
from oss.src.core.agent_templates.compiler import TemplateCompiler
from oss.src.core.agent_templates.dtos import TemplateLoadCommand, TemplateSourcePin
from oss.src.core.agent_templates.exceptions import (
    TemplateCreateConflict,
    TemplateSkillCreationFailed,
    TemplateWorkflowCreationFailed,
)
from oss.src.core.agent_templates.interfaces import TemplateSourceResolver
from oss.src.core.agent_templates.message import compose_first_message
from oss.src.core.agent_templates.models import PreparedTemplateLoad, TemplateLoadResult
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.provenance import (
    read_create_request,
    read_template_origin,
    template_origin_meta,
)
from oss.src.core.mounts.dtos import MountFileSeed
from oss.src.core.mounts.service import MountsService
from oss.src.core.sessions.starts.service import SessionStartsService
from oss.src.core.shared.exceptions import EntityCreationIdempotencyConflict
from oss.src.core.shared.idempotency import request_fingerprint, request_key_hash
from oss.src.core.skills.dtos import InstalledSkillRef
from oss.src.core.skills.service import SkillsService
from oss.src.core.workflows.dtos import (
    SimpleWorkflow,
    SimpleWorkflowCreate,
    SimpleWorkflowData,
    SimpleWorkflowFlags,
    Workflow,
)
from oss.src.core.workflows.service import SimpleWorkflowsService


_TEMPLATE_LOAD_NAMESPACE = "agent-template-load"
_AGENT_COMPONENT = "agent"


def template_request_fingerprint(command: TemplateLoadCommand) -> str:
    choices = sorted(
        (
            choice.model_dump(mode="json", exclude_none=True)
            for choice in command.connection_choices
        ),
        key=lambda choice: (
            choice.get("connection_key", ""),
            choice.get("kind", ""),
        ),
    )
    return request_fingerprint(
        {
            "source": command.source.model_dump(mode="json", exclude_none=True),
            "base_revision": command.base_revision.model_dump(
                mode="json", exclude_none=True
            ),
            "initial_message": command.initial_message.strip(),
            "connection_choices": choices,
        }
    )


class AgentTemplateLoader:
    """Preflight and create one ordinary agent from one verified package.

    Workspace materialization and the durable session handoff extend this service
    in later phases. The deterministic agent is the recovery root for every
    resource written after preflight.
    """

    def __init__(
        self,
        *,
        source_resolver: TemplateSourceResolver,
        package_parser: TemplatePackageParser,
        binding_resolver: TemplateBindingResolver,
        compiler: TemplateCompiler,
        skills_service: SkillsService,
        simple_workflows_service: SimpleWorkflowsService,
        mounts_service: MountsService | None = None,
        session_starts_service: SessionStartsService | None = None,
    ) -> None:
        self._source_resolver = source_resolver
        self._package_parser = package_parser
        self._binding_resolver = binding_resolver
        self._compiler = compiler
        self._skills_service = skills_service
        self._simple_workflows_service = simple_workflows_service
        self._mounts_service = mounts_service
        self._session_starts_service = session_starts_service

    @staticmethod
    def _request_key(command: TemplateLoadCommand) -> str:
        request_key = command.request_key.strip()
        if not request_key:
            raise ValueError("request_key must not be empty")
        return request_key

    @staticmethod
    def _stored_origin_for_replay(
        *,
        workflow: Workflow | SimpleWorkflow,
        command: TemplateLoadCommand,
        request_key: str,
        request_fingerprint: str,
    ) -> dict[str, Any]:
        create_request = read_create_request(workflow.meta)
        origin = read_template_origin(workflow.meta)
        if (
            create_request is None
            or create_request["key_hash"] != request_key_hash(request_key)
            or create_request["request_fingerprint"] != request_fingerprint
            or origin is None
            or origin["kind"] != command.source.kind
            or origin["key"] != command.source.key
        ):
            raise TemplateCreateConflict()
        return origin

    @staticmethod
    def _verify_origin(
        *,
        workflow: SimpleWorkflow,
        expected_origin: dict[str, Any],
    ) -> None:
        if read_template_origin(workflow.meta) != expected_origin:
            raise TemplateCreateConflict()

    @staticmethod
    def _prepared(
        *,
        workflow: SimpleWorkflow,
        resolved,
        workspace,
        first_message: str,
        replayed: bool,
    ) -> PreparedTemplateLoad:
        if not all(
            (
                workflow.id,
                workflow.slug,
                workflow.variant_id,
                workflow.revision_id,
            )
        ):
            raise TemplateWorkflowCreationFailed()
        return PreparedTemplateLoad(
            workflow_id=workflow.id,
            workflow_slug=workflow.slug,
            variant_id=workflow.variant_id,
            revision_id=workflow.revision_id,
            resolved_source=resolved,
            workspace=workspace,
            first_message=first_message,
            replayed=replayed,
        )

    async def prepare(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        command: TemplateLoadCommand,
    ) -> PreparedTemplateLoad:
        request_key = self._request_key(command)
        fingerprint = template_request_fingerprint(command)

        root = await self._simple_workflows_service.fetch_idempotent_root(
            project_id=project_id,
            namespace=_TEMPLATE_LOAD_NAMESPACE,
            request_key=request_key,
            component=_AGENT_COMPONENT,
        )
        pin = None
        if root is not None:
            stored_origin = self._stored_origin_for_replay(
                workflow=root,
                command=command,
                request_key=request_key,
                request_fingerprint=fingerprint,
            )
            pin = TemplateSourcePin(
                version=stored_origin["version"],
                digest=stored_origin["digest"],
            )

        resolved = await self._source_resolver.resolve(
            source=command.source,
            pin=pin,
        )
        package = self._package_parser.parse(resolved)
        bindings = await self._binding_resolver.resolve(
            project_id=project_id,
            package=package,
            choices=command.connection_choices,
        )
        first_message = compose_first_message(
            initial_message=command.initial_message,
            package=package,
            bindings=bindings,
            choices=command.connection_choices,
        )

        planned_skills = [
            self._skills_service.plan_idempotent_skill_ref(
                project_id=project_id,
                namespace=_TEMPLATE_LOAD_NAMESPACE,
                request_key=request_key,
                skill_name=skill.name,
            )
            for skill in package.skills
        ]
        compiled = self._compiler.compile(
            package=package,
            base_revision=command.base_revision,
            bindings=bindings,
            installed_skills=planned_skills,
            first_message=first_message,
        )
        origin_meta = template_origin_meta(resolved)
        expected_origin = origin_meta["_ag"]["template_origin"]

        try:
            outcome = await self._simple_workflows_service.create_idempotent(
                project_id=project_id,
                user_id=user_id,
                namespace=_TEMPLATE_LOAD_NAMESPACE,
                request_key=request_key,
                request_fingerprint=fingerprint,
                component=_AGENT_COMPONENT,
                simple_workflow_create=SimpleWorkflowCreate(
                    slug=command.source.key,
                    name=compiled.workflow_name,
                    description=compiled.workflow_description,
                    flags=SimpleWorkflowFlags(is_agent=True),
                    data=SimpleWorkflowData(
                        **compiled.revision_data.model_dump(
                            mode="json", exclude_none=True
                        )
                    ),
                ),
                trusted_meta=origin_meta,
            )
        except EntityCreationIdempotencyConflict as exc:
            raise TemplateCreateConflict() from exc

        workflow = outcome.workflow
        self._stored_origin_for_replay(
            workflow=workflow,
            command=command,
            request_key=request_key,
            request_fingerprint=fingerprint,
        )
        self._verify_origin(
            workflow=workflow,
            expected_origin=expected_origin,
        )

        planned_by_name = {skill.name: skill for skill in planned_skills}
        for skill in sorted(package.skills, key=lambda item: item.name):
            try:
                created = await self._skills_service.create_skill_idempotent(
                    project_id=project_id,
                    user_id=user_id,
                    namespace=_TEMPLATE_LOAD_NAMESPACE,
                    request_key=request_key,
                    request_fingerprint=fingerprint,
                    skill=skill.model_dump(mode="json", exclude_none=True),
                )
            except EntityCreationIdempotencyConflict as exc:
                raise TemplateCreateConflict() from exc
            planned: InstalledSkillRef = planned_by_name[skill.name]
            if (
                not created.workflow_id
                or not created.slug
                or UUID(created.workflow_id) != planned.workflow_id
                or created.slug != planned.workflow_slug
            ):
                raise TemplateSkillCreationFailed(skill.name)

        return self._prepared(
            workflow=workflow,
            resolved=resolved,
            workspace=compiled.workspace,
            first_message=compiled.first_message,
            replayed=outcome.replayed,
        )

    async def load(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        command: TemplateLoadCommand,
    ) -> TemplateLoadResult:
        """Create every declared resource before handing off the first turn."""
        if self._mounts_service is None or self._session_starts_service is None:
            raise RuntimeError("Template loader runtime services are not configured.")

        prepared = await self.prepare(
            project_id=project_id,
            user_id=user_id,
            command=command,
        )
        await self._mounts_service.materialize_entries_if_absent(
            project_id=project_id,
            user_id=user_id,
            workflow_id=prepared.workflow_id,
            directories=prepared.workspace.directories,
            files=[
                MountFileSeed(path=item.path, content=item.content)
                for item in prepared.workspace.files
            ],
        )
        start = await self._session_starts_service.start_once(
            project_id=project_id,
            user_id=user_id,
            workflow_id=prepared.workflow_id,
            revision_id=prepared.revision_id,
            message=prepared.first_message,
            request_key=(
                f"{self._request_key(command)}:first-message:"
                f"{prepared.resolved_source.digest}"
            ),
        )
        return TemplateLoadResult(
            workflow_id=prepared.workflow_id,
            workflow_slug=prepared.workflow_slug,
            variant_id=prepared.variant_id,
            revision_id=prepared.revision_id,
            session_id=start.session_id,
            execution_id=start.execution_id,
            input_id=start.input_id,
            replayed=prepared.replayed or start.replayed,
        )
