from pathlib import Path
from uuid import uuid4

import pytest

from agenta.sdk.agents import SkillTemplate

from oss.src.core.agent_templates.compiler import TemplateCompiler
from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
    SkipTemplateChoice,
    TemplateLoadCommand,
)
from oss.src.core.agent_templates.exceptions import (
    TemplateCreateConflict,
    TemplatePackageInvalid,
    TemplateSkillCreationFailed,
)
from oss.src.core.agent_templates.loader import (
    AgentTemplateLoader,
    template_request_fingerprint,
)
from oss.src.core.agent_templates.models import (
    ParsedTemplateAgent,
    ParsedTemplatePackage,
    ParsedWorkspace,
    ParsedWorkspaceFile,
    TemplateBindingPlan,
)
from oss.src.core.agent_templates.provenance import (
    create_request_meta,
    merge_platform_meta,
    read_create_request,
    read_template_origin,
)
from oss.src.core.sessions.starts.dtos import SessionStartResult
from oss.src.core.shared.idempotency import resource_identity, request_key_hash
from oss.src.core.skills.dtos import InstalledSkillRef, SkillCreated
from oss.src.core.workflows.dtos import (
    SimpleWorkflow,
    SimpleWorkflowCreateResult,
    WorkflowRevisionData,
)


PROJECT_ID = uuid4()
USER_ID = uuid4()


def _base_revision() -> WorkflowRevisionData:
    return WorkflowRevisionData(
        uri="agenta:workflow:agent:v0",
        parameters={
            "agent": {
                "instructions": {"agents_md": "Old instructions"},
                "llm": {"model": "openai/gpt-5"},
                "harness": {"kind": "pi_core"},
                "runner": {"kind": "sidecar", "permissions": {"default": "allow"}},
                "sandbox": {"kind": "local"},
                "tools": [],
                "skills": [],
                "mcps": [],
            }
        },
    )


def _command(*, request_key="request-1", initial_message="Please set yourself up."):
    return TemplateLoadCommand(
        source=InternalTemplateSource(key="sample"),
        base_revision=_base_revision(),
        initial_message=initial_message,
        request_key=request_key,
    )


def _resolved() -> ResolvedTemplateSource:
    return ResolvedTemplateSource(
        source=InternalTemplateSource(key="sample"),
        root=Path("/tmp/sample"),
        version="1.0.0",
        digest="sha256:" + "1" * 64,
    )


def _package() -> ParsedTemplatePackage:
    return ParsedTemplatePackage(
        source=InternalTemplateSource(key="sample"),
        version="1.0.0",
        digest="sha256:" + "1" * 64,
        agent=ParsedTemplateAgent(
            key="sample",
            name="Sample agent",
            description="Does sample work.",
            instructions="# Sample agent\n\nFollow the saved rules.",
            setup="Ask for the target profile.",
        ),
        skills=[
            SkillTemplate(
                name="prospect-research",
                description="Research one prospect.",
                body="Find public evidence and cite it.",
            )
        ],
        workspace=ParsedWorkspace(
            directories=["reports"],
            files=[
                ParsedWorkspaceFile(
                    source="files/target-profile.md",
                    path="target-profile.md",
                    content=b"# Target profile\n",
                )
            ],
        ),
    )


class _Resolver:
    def __init__(self, events):
        self.events = events
        self.current = _resolved()
        self.snapshots = {
            (self.current.version, self.current.digest): self.current,
        }
        self.pins = []

    async def resolve(self, *, source, pin=None):
        self.events.append("source")
        self.pins.append(pin)
        if pin is None:
            return self.current
        return self.snapshots[(pin.version, pin.digest)]


class _Parser:
    def __init__(self, events, *, error=None):
        self.events = events
        self.error = error

    def parse(self, resolved):
        self.events.append("parse")
        if self.error:
            raise self.error
        return _package()


class _Bindings:
    def __init__(self, events, *, error=None):
        self.events = events
        self.error = error

    async def resolve(self, *, project_id, package, choices):
        self.events.append("bindings")
        if self.error:
            raise self.error
        return TemplateBindingPlan()


class _Skills:
    def __init__(self, events, *, fail=False):
        self.events = events
        self.fail = fail
        self.records = {}

    def plan_idempotent_skill_ref(
        self, *, project_id, namespace, request_key, skill_name
    ):
        self.events.append("plan-skill")
        workflow_id = resource_identity(
            project_id, namespace, request_key, f"skill:{skill_name}"
        )
        return InstalledSkillRef(
            name=skill_name,
            workflow_id=workflow_id,
            workflow_slug=f"{skill_name}-{workflow_id.hex[:8]}",
        )

    async def create_skill_idempotent(
        self,
        *,
        project_id,
        user_id,
        namespace,
        request_key,
        request_fingerprint,
        skill,
    ):
        self.events.append("skill")
        if self.fail:
            return SkillCreated()
        workflow_id = resource_identity(
            project_id, namespace, request_key, f"skill:{skill['name']}"
        )
        planned = InstalledSkillRef(
            name=skill["name"],
            workflow_id=workflow_id,
            workflow_slug=f"{skill['name']}-{workflow_id.hex[:8]}",
        )
        key = (project_id, namespace, request_key, skill["name"])
        if key not in self.records:
            self.records[key] = SkillCreated(
                workflow_id=str(planned.workflow_id),
                slug=planned.workflow_slug,
                revision_id=str(uuid4()),
            )
        return self.records[key]


class _SimpleWorkflows:
    def __init__(self, events):
        self.events = events
        self.records = {}
        self.create_calls = 0

    async def fetch_idempotent_root(
        self, *, project_id, namespace, request_key, component
    ):
        workflow_id = resource_identity(project_id, namespace, request_key, component)
        return self.records.get(workflow_id)

    async def create_idempotent(
        self,
        *,
        project_id,
        user_id,
        namespace,
        request_key,
        request_fingerprint,
        component,
        simple_workflow_create,
        trusted_meta=None,
    ):
        self.events.append("workflow")
        self.create_calls += 1
        workflow_id = resource_identity(project_id, namespace, request_key, component)
        replayed = workflow_id in self.records
        if not replayed:
            metadata = merge_platform_meta(
                None,
                trusted_meta,
                create_request_meta(
                    key_hash=request_key_hash(request_key),
                    request_fingerprint=request_fingerprint,
                ),
            )
            self.records[workflow_id] = SimpleWorkflow(
                id=workflow_id,
                slug=f"{simple_workflow_create.slug}-{workflow_id.hex[:8]}",
                name=simple_workflow_create.name,
                description=simple_workflow_create.description,
                flags=simple_workflow_create.flags,
                meta=metadata,
                data=simple_workflow_create.data,
                variant_id=uuid4(),
                revision_id=uuid4(),
            )
        return SimpleWorkflowCreateResult(
            workflow=self.records[workflow_id],
            replayed=replayed,
        )


class _Mounts:
    def __init__(self, events, *, fail_once=False):
        self.events = events
        self.fail_once = fail_once
        self.calls = []

    async def materialize_entries_if_absent(self, **kwargs):
        self.events.append("workspace")
        self.calls.append(kwargs)
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("injected workspace failure")


class _Starts:
    def __init__(self, events, *, fail_once=False):
        self.events = events
        self.fail_once = fail_once
        self.calls = []
        self.result = None

    async def start_once(self, **kwargs):
        self.events.append("session")
        self.calls.append(kwargs)
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("injected session failure")
        if self.result is None:
            self.result = SessionStartResult(
                session_id=str(uuid4()),
                execution_id=str(uuid4()),
                input_id=uuid4(),
                replayed=False,
            )
        else:
            self.result = self.result.model_copy(update={"replayed": True})
        return self.result


def _loader(
    *,
    parser_error=None,
    binding_error=None,
    skill_fail=False,
    mount_fail_once=False,
    start_fail_once=False,
):
    events = []
    skills = _Skills(events, fail=skill_fail)
    workflows = _SimpleWorkflows(events)
    resolver = _Resolver(events)
    mounts = _Mounts(events, fail_once=mount_fail_once)
    starts = _Starts(events, fail_once=start_fail_once)
    loader = AgentTemplateLoader(
        source_resolver=resolver,
        package_parser=_Parser(events, error=parser_error),
        binding_resolver=_Bindings(events, error=binding_error),
        compiler=TemplateCompiler(),
        skills_service=skills,
        simple_workflows_service=workflows,
        mounts_service=mounts,
        session_starts_service=starts,
    )
    return loader, events, skills, workflows, resolver, mounts, starts


@pytest.mark.asyncio
async def test_prepare_finishes_preflight_then_creates_agent_before_skills():
    loader, events, skills, workflows, _, _, _ = _loader()

    result = await loader.prepare(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=_command(),
    )

    assert events == [
        "source",
        "parse",
        "bindings",
        "plan-skill",
        "workflow",
        "skill",
    ]
    assert result.workflow_id
    assert result.variant_id
    assert result.revision_id
    assert result.replayed is False
    assert "Template-supplied setup guidance" in result.first_message
    assert len(skills.records) == 1
    workflow = next(iter(workflows.records.values()))
    assert workflow.flags.is_application is True
    assert workflow.flags.is_evaluator is False
    assert workflow.flags.is_snippet is False
    agent = workflow.data.parameters["agent"]
    assert agent["instructions"]["agents_md"].startswith("# Sample agent")
    assert agent["skills"][0]["@ag.embed"]["@ag.references"]["workflow"]["slug"]
    assert read_template_origin(workflow.meta)["key"] == "sample"
    assert read_create_request(workflow.meta)["request_fingerprint"].startswith(
        "sha256:"
    )


@pytest.mark.asyncio
async def test_source_or_package_failure_leaves_no_resources():
    error = TemplatePackageInvalid("bad_package", "bad package")
    loader, events, skills, workflows, _, _, _ = _loader(parser_error=error)

    with pytest.raises(TemplatePackageInvalid):
        await loader.prepare(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            command=_command(),
        )

    assert events == ["source", "parse"]
    assert not skills.records
    assert not workflows.records


@pytest.mark.asyncio
async def test_binding_validation_failure_happens_before_skill_or_agent_writes():
    error = TemplatePackageInvalid("bad_choice", "bad choice")
    loader, events, skills, workflows, _, _, _ = _loader(binding_error=error)

    with pytest.raises(TemplatePackageInvalid):
        await loader.prepare(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            command=_command(),
        )

    assert events == ["source", "parse", "bindings"]
    assert not skills.records
    assert not workflows.records


@pytest.mark.asyncio
async def test_native_configuration_validation_happens_before_resource_writes():
    loader, events, skills, workflows, _, _, _ = _loader()
    command = _command().model_copy(
        update={"base_revision": WorkflowRevisionData(parameters={})}
    )

    with pytest.raises(TemplatePackageInvalid, match="ordinary agent configuration"):
        await loader.prepare(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            command=command,
        )

    assert events == ["source", "parse", "bindings", "plan-skill"]
    assert not skills.records
    assert not workflows.records


@pytest.mark.asyncio
async def test_skill_failure_leaves_only_the_recoverable_agent_root():
    loader, events, _, workflows, _, _, _ = _loader(skill_fail=True)

    with pytest.raises(TemplateSkillCreationFailed):
        await loader.prepare(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            command=_command(),
        )

    assert events == [
        "source",
        "parse",
        "bindings",
        "plan-skill",
        "workflow",
        "skill",
    ]
    assert len(workflows.records) == 1


@pytest.mark.asyncio
async def test_same_key_replay_uses_stored_source_pin_without_duplicates():
    loader, _, skills, workflows, resolver, _, _ = _loader()
    command = _command()

    first = await loader.prepare(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=command,
    )
    resolver.current = ResolvedTemplateSource(
        source=InternalTemplateSource(key="sample"),
        root=Path("/tmp/sample-v2"),
        version="2.0.0",
        digest="sha256:" + "2" * 64,
    )
    second = await loader.prepare(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=command,
    )

    assert first.workflow_id == second.workflow_id
    assert second.replayed is True
    assert second.resolved_source.digest == "sha256:" + "1" * 64
    assert resolver.pins[-1].digest == "sha256:" + "1" * 64
    assert len(skills.records) == 1
    assert len(workflows.records) == 1
    assert workflows.create_calls == 2


@pytest.mark.asyncio
async def test_same_key_with_changed_payload_conflicts_before_new_writes():
    loader, _, skills, workflows, resolver, _, _ = _loader()

    await loader.prepare(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=_command(),
    )
    with pytest.raises(TemplateCreateConflict):
        await loader.prepare(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            command=_command(initial_message="Use different setup text."),
        )

    assert len(skills.records) == 1
    assert len(workflows.records) == 1
    assert workflows.create_calls == 1
    assert len(resolver.pins) == 1


@pytest.mark.asyncio
async def test_different_request_keys_create_distinct_agents():
    loader, _, skills, workflows, _, _, _ = _loader()

    first = await loader.prepare(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=_command(request_key="request-1"),
    )
    second = await loader.prepare(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=_command(request_key="request-2"),
    )

    assert first.workflow_id != second.workflow_id
    assert len(workflows.records) == 2
    assert len(skills.records) == 2


@pytest.mark.asyncio
async def test_load_materializes_workspace_before_starting_the_session():
    loader, events, _, _, _, mounts, starts = _loader()

    result = await loader.load(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=_command(),
    )

    assert events == [
        "source",
        "parse",
        "bindings",
        "plan-skill",
        "workflow",
        "skill",
        "workspace",
        "session",
    ]
    assert mounts.calls[0]["directories"] == ["reports"]
    assert mounts.calls[0]["files"][0].path == "target-profile.md"
    assert mounts.calls[0]["files"][0].content == b"# Target profile\n"
    assert starts.calls[0]["workflow_id"] == result.workflow_id
    assert starts.calls[0]["revision_id"] == result.revision_id
    assert starts.calls[0]["request_key"].endswith(":first-message:sha256:" + "1" * 64)
    assert result.replayed is False


@pytest.mark.asyncio
async def test_workspace_failure_prevents_handoff_and_retry_recovers():
    loader, _, skills, workflows, _, mounts, starts = _loader(mount_fail_once=True)

    with pytest.raises(RuntimeError, match="workspace failure"):
        await loader.load(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            command=_command(),
        )
    assert starts.calls == []

    result = await loader.load(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=_command(),
    )

    assert result.replayed is True
    assert len(workflows.records) == 1
    assert len(skills.records) == 1
    assert len(mounts.calls) == 2
    assert len(starts.calls) == 1


@pytest.mark.asyncio
async def test_session_failure_retries_after_all_resources_without_duplicates():
    loader, _, skills, workflows, _, mounts, starts = _loader(start_fail_once=True)

    with pytest.raises(RuntimeError, match="session failure"):
        await loader.load(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            command=_command(),
        )
    result = await loader.load(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=_command(),
    )

    assert result.replayed is True
    assert len(workflows.records) == 1
    assert len(skills.records) == 1
    assert len(mounts.calls) == 2
    assert len(starts.calls) == 2


@pytest.mark.asyncio
async def test_load_replay_pins_source_and_returns_same_public_ids():
    loader, _, _, _, resolver, _, _ = _loader()
    command = _command()

    first = await loader.load(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=command,
    )
    resolver.current = ResolvedTemplateSource(
        source=InternalTemplateSource(key="sample"),
        root=Path("/tmp/sample-v2"),
        version="2.0.0",
        digest="sha256:" + "2" * 64,
    )
    replay = await loader.load(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=command,
    )

    assert replay.replayed is True
    assert replay.model_dump(exclude={"replayed"}) == first.model_dump(
        exclude={"replayed"}
    )
    assert resolver.pins[-1].digest == "sha256:" + "1" * 64


def test_request_fingerprint_normalizes_choice_order():
    choices = [
        SkipTemplateChoice(connection_key="b", kind="skip"),
        SkipTemplateChoice(connection_key="a", kind="skip"),
    ]
    left = _command().model_copy(update={"connection_choices": choices})
    right = _command().model_copy(
        update={"connection_choices": list(reversed(choices))}
    )

    assert template_request_fingerprint(left) == template_request_fingerprint(right)
    padded = _command(initial_message="  Please set yourself up.  ")
    assert template_request_fingerprint(padded) == template_request_fingerprint(
        _command()
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [False, True])
async def test_first_message_display_and_run_only_build_kit(enabled):
    loader, _, _, workflows, _, _, starts = _loader()
    command = _command(initial_message="Create my checklist.").model_copy(
        update={
            "ui_build_kit_enabled": enabled,
            "ui_disabled_ops": ["create_schedule"],
        }
    )
    await loader.load(project_id=PROJECT_ID, user_id=USER_ID, command=command)
    saved = next(iter(workflows.records.values())).data.parameters["agent"]
    assert len(saved["skills"]) == 1
    assert not any(t.get("name") == "Request input" for t in saved["tools"])
    call = starts.calls[0]
    assert call["message"].display_content == "Create my checklist."
    assert "Ask for the target profile." in call["message"].content
    assert "Template-supplied setup guidance" in call["message"].content
    if enabled:
        agent = call["parameters"]["agent"]
        ops = {t.get("op") for t in agent["tools"]}
        assert any(t.get("name") == "Request input" for t in agent["tools"])
        assert "create_schedule" not in ops
        assert len(agent["skills"]) == 2
    else:
        assert call["parameters"] is None


@pytest.mark.asyncio
async def test_staged_attachment_is_copied_to_started_session_before_dispatch():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from oss.src.core.sessions.starts.service import SessionStartsService

    loader, _, _, _, _, _, starts = _loader()
    source_id, copied_id = uuid4(), uuid4()
    attachments = AsyncMock()
    attachments.fetch_attachment_content.return_value = SimpleNamespace(
        attachment=SimpleNamespace(
            id=source_id, filename="brief.txt", media_type="text/plain"
        ),
        data=b"Source facts",
    )
    attachments.create_attachment.return_value = SimpleNamespace(
        id=copied_id,
        filename="brief.txt",
        media_type="text/plain",
        size=12,
    )
    loader._attachments_service = attachments
    command = _command().model_copy(
        update={"staging_session_id": "staging", "attachment_ids": [source_id]}
    )
    await loader.load(project_id=PROJECT_ID, user_id=USER_ID, command=command)
    attachments.fetch_attachment_content.assert_awaited_once_with(
        project_id=PROJECT_ID,
        session_id="staging",
        attachment_id=source_id,
    )
    start = starts.calls[0]
    assert attachments.create_attachment.await_args.kwargs[
        "session_id"
    ] == SessionStartsService.session_id_for(
        project_id=PROJECT_ID,
        request_key=start["request_key"],
    )
    assert start["message"].to_wire()["content"][-1]["attachmentId"] == str(copied_id)
    assert start["message"].display_content == command.initial_message


@pytest.mark.asyncio
async def test_foreign_or_missing_staged_attachment_fails_before_resource_creation():
    from unittest.mock import AsyncMock
    from oss.src.core.sessions.attachments.types import AttachmentNotFound

    loader, events, _, _, _, _, starts = _loader()
    attachment_id = uuid4()
    loader._attachments_service = AsyncMock()
    loader._attachments_service.fetch_attachment_content.side_effect = (
        AttachmentNotFound(attachment_id=attachment_id)
    )
    command = _command().model_copy(
        update={"staging_session_id": "foreign", "attachment_ids": [attachment_id]}
    )
    with pytest.raises(TemplatePackageInvalid, match="unavailable"):
        await loader.load(project_id=PROJECT_ID, user_id=USER_ID, command=command)
    assert events == []
    assert starts.calls == []
