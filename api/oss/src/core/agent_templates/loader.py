import hashlib
import json
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

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
from oss.src.core.agent_templates.models import (
    InstalledSkillRef,
    PreparedTemplateLoad,
)
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.provenance import (
    create_request_meta,
    merge_platform_meta,
    read_create_request,
    read_template_origin,
    template_origin_meta,
)
from oss.src.core.skills.service import SkillsService
from oss.src.core.workflows.dtos import (
    SimpleWorkflow,
    SimpleWorkflowCreate,
    SimpleWorkflowData,
    SimpleWorkflowFlags,
)
from oss.src.core.workflows.service import SimpleWorkflowsService


_AGENT_CREATE_KEY_PREFIX = "agent-template:"


def _sha256_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def template_request_fingerprint(command: TemplateLoadCommand) -> str:
    choices = sorted(
        (
            choice.model_dump(mode="json", exclude_none=True)
            for choice in command.connection_choices
        ),
        key=lambda choice: (
            choice.get("connection_key", ""),
            choice.get("kind", ""),
            _canonical_json(choice),
        ),
    )
    payload = {
        "source": command.source.model_dump(mode="json", exclude_none=True),
        "base_revision": command.base_revision.model_dump(
            mode="json", exclude_none=True
        ),
        "initial_message": command.initial_message,
        "connection_choices": choices,
    }
    return _sha256_text(_canonical_json(payload))


class AgentTemplateLoader:
    """Validate and compile one package, then create one ordinary agent.

    This phase deliberately stops before workspace copying and session handoff.
    Those steps extend the same service without changing source, binding, skill,
    or workflow ownership.
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
    ) -> None:
        self._source_resolver = source_resolver
        self._package_parser = package_parser
        self._binding_resolver = binding_resolver
        self._compiler = compiler
        self._skills_service = skills_service
        self._simple_workflows_service = simple_workflows_service

    @staticmethod
    def _create_key(command: TemplateLoadCommand) -> str:
        if not command.request_key.strip():
            raise ValueError("request_key must not be empty")
        return _AGENT_CREATE_KEY_PREFIX + command.request_key

    @staticmethod
    def _stored_origin_for_replay(
        *,
        workflow: SimpleWorkflow,
        command: TemplateLoadCommand,
        key_hash: str,
        request_fingerprint: str,
    ) -> dict[str, Any]:
        create_request = read_create_request(workflow.meta)
        origin = read_template_origin(workflow.meta)
        if (
            create_request is None
            or create_request["key_hash"] != key_hash
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
        create_key = self._create_key(command)
        key_hash = _sha256_text(create_key)
        request_fingerprint = template_request_fingerprint(command)

        requested_slug = command.source.key
        existing = await self._simple_workflows_service.fetch_idempotent(
            project_id=project_id,
            requested_slug=requested_slug,
            idempotency_key=create_key,
        )
        pin = None
        if existing is not None:
            stored_origin = self._stored_origin_for_replay(
                workflow=existing,
                command=command,
                key_hash=key_hash,
                request_fingerprint=request_fingerprint,
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
        origin_meta = template_origin_meta(resolved)
        expected_origin = origin_meta["_ag"]["template_origin"]

        if existing is not None:
            self._verify_origin(
                workflow=existing,
                expected_origin=expected_origin,
            )
            return self._prepared(
                workflow=existing,
                resolved=resolved,
                workspace=package.workspace,
                first_message=first_message,
                replayed=True,
            )

        skill_key_prefix = (
            f"{resolved.source.kind}:{resolved.source.key}:"
            f"{resolved.version}:{resolved.digest}"
        )
        # Validate the complete native configuration before any resource write.
        # The planned references have the same native shape as installed ones;
        # the final compile below substitutes the service-owned identities.
        planned_skills = [
            InstalledSkillRef(
                name=skill.name,
                workflow_id=uuid5(
                    NAMESPACE_URL,
                    f"{skill_key_prefix}:{skill.name}",
                ),
                workflow_slug=f"{skill.name}-planned",
            )
            for skill in package.skills
        ]
        self._compiler.compile(
            package=package,
            base_revision=command.base_revision,
            bindings=bindings,
            installed_skills=planned_skills,
            first_message=first_message,
        )

        installed_skills: list[InstalledSkillRef] = []
        for skill in package.skills:
            created = await self._skills_service.create_skill(
                project_id=project_id,
                user_id=user_id,
                skill=skill.model_dump(mode="json", exclude_none=True),
                idempotency_key=skill_key_prefix,
            )
            if not created.workflow_id or not created.slug:
                raise TemplateSkillCreationFailed(skill.name)
            installed_skills.append(
                InstalledSkillRef(
                    name=skill.name,
                    workflow_id=UUID(created.workflow_id),
                    workflow_slug=created.slug,
                )
            )

        compiled = self._compiler.compile(
            package=package,
            base_revision=command.base_revision,
            bindings=bindings,
            installed_skills=installed_skills,
            first_message=first_message,
        )
        metadata = merge_platform_meta(
            None,
            origin_meta,
            create_request_meta(
                key_hash=key_hash,
                request_fingerprint=request_fingerprint,
            ),
        )
        workflow = await self._simple_workflows_service.create_idempotent(
            project_id=project_id,
            user_id=user_id,
            simple_workflow_create=SimpleWorkflowCreate(
                slug=requested_slug,
                name=compiled.workflow_name,
                description=compiled.workflow_description,
                flags=SimpleWorkflowFlags(is_agent=True),
                meta=metadata,
                data=SimpleWorkflowData(
                    **compiled.revision_data.model_dump(mode="json", exclude_none=True)
                ),
            ),
            idempotency_key=create_key,
            platform_meta=True,
        )
        if workflow is None:
            raise TemplateWorkflowCreationFailed()
        self._stored_origin_for_replay(
            workflow=workflow,
            command=command,
            key_hash=key_hash,
            request_fingerprint=request_fingerprint,
        )
        self._verify_origin(
            workflow=workflow,
            expected_origin=expected_origin,
        )
        return self._prepared(
            workflow=workflow,
            resolved=resolved,
            workspace=compiled.workspace,
            first_message=compiled.first_message,
            replayed=False,
        )
