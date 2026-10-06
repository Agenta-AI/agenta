"""`list_agents`, `read_agent_config`, `create_agent` and `edit_agent_config`.

An agent lists, reads, creates and edits the OTHER agents in its project. These cells hold
the four properties that make that safe to turn on by default:

- the project comes from the credential and the caller from run context, so nothing the
  model sends can reach another project, retarget itself, or forge the attribution;
- an edit takes the same commit path as `commit_revision`: the same scope, the same
  stale-base check, the same derived message, plus the attribution;
- a create starts from the same template "New agent" uses and applies its operations before
  anything is written, so a failed operation creates nothing;
- every refusal is the canonical envelope with a next step that names the right tool.

The service is real and its storage is mocked, so the scope, the conflict check and the
message come from the production code path rather than from a stub.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock
from uuid import UUID, uuid4, uuid5

import pytest

from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from oss.src.core.access.permissions.types import Permission
from oss.src.core.tools import platform_handlers
from oss.src.core.tools.platform_handlers import (
    CREATE_AGENT_CALL_REF,
    EDIT_AGENT_CONFIG_CALL_REF,
    LIST_AGENTS_CALL_REF,
    PLATFORM_TOOL_HANDLERS,
    READ_AGENT_CONFIG_CALL_REF,
    PlatformToolHandlerRefused,
    handle_commit_revision,
    handle_create_agent,
    handle_edit_agent_config,
    handle_list_agents,
    handle_read_agent_config,
    required_elevated_permission,
)
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.workflows.dtos import (
    SimpleWorkflow,
    SimpleWorkflowCreateResult,
    Workflow,
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowRevisionFlags,
    WorkflowVariant,
)
from oss.src.core.workflows.new_agent import new_agent_revision_data
from oss.src.core.workflows.service import SimpleWorkflowsService, WorkflowsService


# Fixed, so parametrized test ids are the same in every pytest-xdist worker.
PROJECT = UUID("00000000-0000-4000-8000-000000000001")
USER = UUID("00000000-0000-4000-8000-000000000002")
CALLER = UUID("00000000-0000-4000-8000-000000000003")
TARGET = UUID("00000000-0000-4000-8000-000000000004")
TARGET_VARIANT = UUID("00000000-0000-4000-8000-000000000005")
HEAD = UUID("00000000-0000-4000-8000-000000000006")
STATIC_ID = "00000000-0000-4000-8000-000000000007"
OTHER = UUID("00000000-0000-4000-8000-000000000008")
SESSION = "01a1-session"
INSTRUCTIONS = ["parameters", "agent", "instructions", "agents_md"]


def _workflow(id_, name, slug, *, archived=False):
    return Workflow(
        id=id_,
        name=name,
        slug=slug,
        description=f"{name} description",
        deleted_at=datetime.now(timezone.utc) if archived else None,
    )


def _head(*, is_agent=True, is_static=False, workflow_id=TARGET, archived=False):
    return WorkflowRevision(
        id=HEAD,
        workflow_id=workflow_id,
        workflow_variant_id=TARGET_VARIANT,
        version="3",
        created_at=datetime(2026, 10, 6, tzinfo=timezone.utc),
        deleted_at=datetime.now(timezone.utc) if archived else None,
        flags=WorkflowRevisionFlags(is_agent=is_agent, is_static=is_static),
        data=WorkflowRevisionData(
            uri="agenta:builtin:agent:v0",
            parameters={
                "agent": {
                    "instructions": {"agents_md": "Answer invoice questions."},
                    "tools": [
                        {"type": "agenta_tools", "tools": {"rename_session": "allow"}}
                    ],
                    "sandbox": {"kind": "local", "credentials": []},
                }
            },
        ),
    )


@pytest.fixture
def workflows():
    return {
        CALLER: _workflow(CALLER, "Support Triage", "support-triage"),
        TARGET: _workflow(TARGET, "Invoice helper", "invoice-helper-k3x9"),
    }


@pytest.fixture
def service(workflows):
    """A real service over a mocked store: every read returns the target's head."""
    service = WorkflowsService(workflows_dao=AsyncMock())

    async def fetch_workflow(*, project_id, workflow_ref, include_archived=True):
        assert project_id == PROJECT
        return workflows.get(workflow_ref.id)

    service.fetch_workflow = AsyncMock(side_effect=fetch_workflow)
    service.fetch_workflow_revision = AsyncMock(return_value=_head())
    service.commit_workflow_revision = AsyncMock(
        side_effect=lambda **kwargs: WorkflowRevision(
            id=uuid4(),
            workflow_id=TARGET,
            workflow_variant_id=TARGET_VARIANT,
            version="4",
            message=kwargs["workflow_revision_commit"].message,
        )
    )
    return service


def _call(handler, service, **arguments):
    return handler(
        arguments=arguments,
        project_id=PROJECT,
        user_id=USER,
        workflows_service=service,
    )


def _edit_args(**over):
    return {
        "agent": "invoice-helper-k3x9",
        "base_revision_id": str(HEAD),
        "operations": [
            {
                "operation": "edit_text",
                "target": INSTRUCTIONS,
                "edits": [{"old_text": "invoice", "new_text": "billing"}],
            }
        ],
        "caller_agent_id": str(CALLER),
        "caller_session_id": SESSION,
        **over,
    }


def _committed(service):
    return service.commit_workflow_revision.await_args.kwargs[
        "workflow_revision_commit"
    ]


# --------------------------------------------------------------------------------------
# Registration and permissions
# --------------------------------------------------------------------------------------


class TestRegistration:
    def test_every_handler_op_in_the_catalog_has_a_handler_here(self):
        # The SDK catalog and this registry are two halves of one allowlist.
        handlers = {op.handler for op in PLATFORM_OPS.values() if op.handler}
        assert handlers == set(PLATFORM_TOOL_HANDLERS)

    @pytest.mark.parametrize(
        "ref,permission",
        [
            (LIST_AGENTS_CALL_REF, Permission.VIEW_WORKFLOWS),
            (READ_AGENT_CONFIG_CALL_REF, Permission.VIEW_WORKFLOWS),
            (CREATE_AGENT_CALL_REF, Permission.EDIT_WORKFLOWS),
            (EDIT_AGENT_CONFIG_CALL_REF, Permission.EDIT_WORKFLOWS),
        ],
    )
    def test_reads_need_view_and_writes_need_edit_whatever_the_arguments(
        self, ref, permission
    ):
        for arguments in ({}, _edit_args()):
            assert (
                required_elevated_permission(call_ref=ref, arguments=arguments)
                == permission
            )


class TestTheCallerBindingFailsClosed:
    @pytest.mark.parametrize(
        "handler",
        [handle_read_agent_config, handle_edit_agent_config, handle_create_agent],
    )
    async def test_a_missing_caller_is_refused_not_guessed(self, handler, service):
        with pytest.raises(PlatformToolHandlerRefused):
            await _call(handler, service, agent="invoice-helper-k3x9", name="X")


# --------------------------------------------------------------------------------------
# list_agents
# --------------------------------------------------------------------------------------


class TestListAgents:
    """One row per agent, from the head read and edit act on, paged over agents."""

    @pytest.fixture
    def listing(self, service, workflows):
        workflows[OTHER] = _workflow(OTHER, "Old prompt app", "old-prompt-app")
        heads = {
            TARGET: _head(),
            CALLER: _head(workflow_id=CALLER),
            # Was an agent once; its default variant's head is not one today.
            OTHER: _head(workflow_id=OTHER, is_agent=False),
        }

        def variants(workflow_id):
            # Two variants: the older one is the default the read and edit tools use.
            return [
                WorkflowVariant(
                    id=uuid5(workflow_id, "newer"),
                    workflow_id=workflow_id,
                    created_at=datetime(2026, 10, 2, tzinfo=timezone.utc),
                ),
                WorkflowVariant(
                    id=uuid5(workflow_id, "default"),
                    workflow_id=workflow_id,
                    created_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
                ),
            ]

        async def query_variants(*, project_id, workflow_refs, include_archived):
            assert project_id == PROJECT
            return [v for ref in workflow_refs for v in variants(ref.id)]

        async def query_heads(
            *, project_id, workflow_variant_refs, include_archived, grouping
        ):
            assert grouping.by == "variant" and grouping.get == "latest"
            by_variant = {
                uuid5(workflow_id, "default"): head
                for workflow_id, head in heads.items()
            }
            return [by_variant[ref.id] for ref in workflow_variant_refs]

        service.query_workflows = AsyncMock(
            return_value=[workflows[TARGET], workflows[OTHER], workflows[CALLER]]
        )
        service.query_workflow_variants = AsyncMock(side_effect=query_variants)
        service.query_workflow_revisions = AsyncMock(side_effect=query_heads)
        return service

    async def test_lists_agents_including_the_caller_one_row_each(self, listing):
        result = await _call(handle_list_agents, listing)

        assert result.ok
        agents = result.content["agents"]
        assert [agent["name"] for agent in agents] == [
            "Invoice helper",
            "Support Triage",
        ]
        assert set(agents[0]) == {
            "id",
            "slug",
            "name",
            "description",
            "version",
            "updated_at",
        }
        assert agents[0]["version"] == "3"
        assert result.content["next_cursor"] is None

    async def test_heads_are_read_in_one_batch_from_the_default_variants(self, listing):
        await _call(handle_list_agents, listing)

        # The oldest variant is the default, as for `read_agent_config`.
        refs = listing.query_workflow_revisions.await_args.kwargs[
            "workflow_variant_refs"
        ]
        assert {ref.id for ref in refs} == {
            uuid5(workflow_id, "default") for workflow_id in (TARGET, OTHER, CALLER)
        }
        listing.query_workflow_variants.assert_awaited_once()
        listing.query_workflow_revisions.assert_awaited_once()

    async def test_pages_run_over_applications_in_the_credential_project(self, listing):
        # A project in the arguments is not a parameter; the credential decides.
        await _call(handle_list_agents, listing, project_id=str(uuid4()))

        kwargs = listing.query_workflows.await_args.kwargs
        assert kwargs["project_id"] == PROJECT
        assert kwargs["workflow_query"].flags.is_application is True
        assert kwargs["include_archived"] is False

    async def test_a_page_is_filled_with_agents_and_its_cursor_is_the_last_one(
        self, listing
    ):
        first = await _call(handle_list_agents, listing, limit=1)
        assert [agent["name"] for agent in first.content["agents"]] == [
            "Invoice helper"
        ]
        assert first.content["next_cursor"] == str(TARGET)

        # Skipping the application that is not an agent, the page still holds `limit`.
        second = await _call(handle_list_agents, listing, limit=2)
        assert len(second.content["agents"]) == 2
        assert second.content["next_cursor"] is None

    async def test_the_scan_continues_from_the_cursor(self, listing, workflows):
        batches = [
            [workflows[OTHER]] * platform_handlers.LIST_AGENTS_MAX_LIMIT,
            [workflows[TARGET]],
        ]
        listing.query_workflows = AsyncMock(side_effect=batches)

        result = await _call(handle_list_agents, listing, limit=1)

        # The first batch held no agent, so the scan read the next one from its last row.
        assert [agent["name"] for agent in result.content["agents"]] == [
            "Invoice helper"
        ]
        windowing = listing.query_workflows.await_args.kwargs["windowing"]
        assert windowing.next == OTHER
        assert result.content["next_cursor"] is None

    async def test_archived_agents_only_on_request_and_marked(self, listing, workflows):
        archived = _workflow(TARGET, "Old", "old", archived=True)
        listing.query_workflows.return_value = [archived, workflows[CALLER]]

        result = await _call(handle_list_agents, listing, include_archived=True)

        assert listing.query_workflows.await_args.kwargs["include_archived"] is True
        assert result.content["agents"][0]["archived"] is True
        assert "archived" not in result.content["agents"][1]

    @pytest.mark.parametrize(
        "arguments",
        [{"cursor": "not-a-cursor"}, {"limit": 0}, {"limit": 101}, {"limit": "5"}],
    )
    async def test_bad_paging_is_an_envelope_with_a_next_step(self, listing, arguments):
        result = await _call(handle_list_agents, listing, **arguments)

        assert not result.ok
        assert result.content.code == "invalid_arguments"
        assert result.content.next_step


# --------------------------------------------------------------------------------------
# Target resolution: shared by read and edit
# --------------------------------------------------------------------------------------


class TestTheTargetIsAnotherAgentInThisProject:
    @pytest.mark.parametrize("agent", ["invoice-helper-k3x9", str(TARGET)])
    async def test_by_slug_or_id(self, service, agent):
        result = await _call(
            handle_read_agent_config,
            service,
            agent=agent,
            caller_agent_id=str(CALLER),
        )

        assert result.ok
        reference = service.fetch_workflow_revision.await_args.kwargs["workflow_ref"]
        assert (reference.slug or str(reference.id)) == agent

    @pytest.mark.parametrize(
        "handler,tool",
        [
            (handle_read_agent_config, "read_config"),
            (handle_edit_agent_config, "commit_revision"),
        ],
    )
    async def test_the_caller_is_sent_to_its_own_tool(self, service, handler, tool):
        service.fetch_workflow_revision.return_value = _head(workflow_id=CALLER)

        result = await _call(handler, service, **_edit_args(agent="support-triage"))

        assert result.content.code == "agent_is_self"
        assert tool in result.content.next_step
        service.commit_workflow_revision.assert_not_awaited()

    async def test_an_agent_of_another_project_is_unknown(self, service):
        # The store answers per project, so another project's agent is simply absent.
        service.fetch_workflow_revision.return_value = None

        result = await _call(handle_edit_agent_config, service, **_edit_args())

        assert result.content.code == "agent_not_found"
        assert "list_agents" in result.content.next_step
        assert service.fetch_workflow_revision.await_args.kwargs["project_id"] == (
            PROJECT
        )

    async def test_a_name_instead_of_a_slug_says_to_use_the_slug(self, service):
        result = await _call(
            handle_read_agent_config,
            service,
            agent="Invoice helper",
            caller_agent_id=str(CALLER),
        )

        assert result.content.code == "agent_not_found"
        assert "not its name" in result.content.next_step

    @pytest.mark.parametrize(
        "head,agent,code",
        [
            (_head(is_static=True), "__ag__build_kit", "agent_is_static"),
            (_head(is_static=True), STATIC_ID, "agent_is_static"),
            # A reserved slug the static catalog does not hold is simply unknown.
            (None, "__ag__nothing", "agent_not_found"),
            (_head(archived=True), "invoice-helper-k3x9", "agent_archived"),
            (_head(is_agent=False), "invoice-helper-k3x9", "not_an_agent"),
        ],
        ids=[
            "static-slug",
            "static-id",
            "unknown-reserved",
            "archived",
            "not-an-agent",
        ],
    )
    @pytest.mark.parametrize(
        "handler", [handle_read_agent_config, handle_edit_agent_config]
    )
    async def test_refused_targets_touch_nothing(
        self, service, handler, head, agent, code
    ):
        service.fetch_workflow_revision.return_value = head

        result = await _call(handler, service, **_edit_args(agent=agent))

        assert not result.ok
        assert result.content.code == code
        assert result.content.next_step
        service.commit_workflow_revision.assert_not_awaited()

    async def test_an_archived_artifact_is_refused_even_with_a_live_head(
        self, service, workflows
    ):
        workflows[TARGET] = _workflow(TARGET, "Invoice helper", "x", archived=True)

        result = await _call(handle_edit_agent_config, service, **_edit_args())

        assert result.content.code == "agent_archived"


# --------------------------------------------------------------------------------------
# read_agent_config
# --------------------------------------------------------------------------------------


class TestReadAgentConfig:
    async def test_answers_like_read_config_from_the_head_it_resolved(self, service):
        result = await _call(
            handle_read_agent_config,
            service,
            agent="invoice-helper-k3x9",
            path=INSTRUCTIONS,
            caller_agent_id=str(CALLER),
        )

        content = result.content
        assert content.base_revision_id == str(HEAD)
        assert content.value == "Answer invoice questions."
        # The draft warning is about the caller's run, not about this agent.
        assert content.is_draft is False and not content.warnings
        # The head the target resolution loaded is the one projected: no second read.
        service.fetch_workflow_revision.assert_awaited_once()

    async def test_a_value_over_the_limit_lists_children(self, service):
        head = _head()
        head.data.parameters["agent"]["instructions"]["agents_md"] = "x" * 4096
        service.fetch_workflow_revision.return_value = head

        result = await _call(
            handle_read_agent_config,
            service,
            agent="invoice-helper-k3x9",
            max_bytes=1024,
            caller_agent_id=str(CALLER),
        )

        assert result.content.code == "output_too_large"
        assert "parameters" in result.content.details["children"]


# --------------------------------------------------------------------------------------
# edit_agent_config
# --------------------------------------------------------------------------------------


class TestEditAgentConfig:
    async def test_commits_to_the_target_head_with_the_attributed_message(
        self, service
    ):
        result = await _call(handle_edit_agent_config, service, **_edit_args())

        assert result.ok, result.content
        commit = _committed(service)
        assert commit.workflow_variant_id == TARGET_VARIANT
        assert commit.message == (
            "edited agents_md (1 edit) "
            f'(by agent "Support Triage" {CALLER}, session {SESSION})'
        )
        assert commit.data.parameters["agent"]["instructions"]["agents_md"] == (
            "Answer billing questions."
        )
        assert result.content["agent"]["name"] == "Invoice helper"
        assert result.content["version"] == "4"
        assert result.content["message"] == commit.message
        # Another agent's write: the caches are cleared, and no self-commit signal goes
        # to the caller's playground.
        assert result.wrote_revision is True
        assert result.committed_revision is None

    async def test_never_deploys(self, service):
        service.environments_service = AsyncMock()

        await _call(handle_edit_agent_config, service, **_edit_args())

        assert service.environments_service.mock_calls == []

    async def test_a_moved_head_is_a_conflict_that_says_read_again(self, service):
        result = await _call(
            handle_edit_agent_config,
            service,
            **_edit_args(base_revision_id=str(uuid4())),
        )

        assert result.content.code == "revision_conflict"
        # The shared text names no tool, so it never sends the model to read itself.
        assert "Read the configuration again" in result.content.next_step
        assert "read_config" not in result.content.next_step
        service.commit_workflow_revision.assert_not_awaited()

    async def test_a_missing_base_revision_says_to_read_first(self, service):
        arguments = _edit_args()
        del arguments["base_revision_id"]

        result = await _call(handle_edit_agent_config, service, **arguments)

        assert result.content.code == "invalid_arguments"
        assert "read_agent_config" in result.content.next_step

    @pytest.mark.parametrize(
        "wrapper",
        [
            lambda ops: {"delta": {"operations": ops}},
            lambda ops: {"workflow_revision": {"delta": {"operations": ops}}},
        ],
        ids=["delta", "workflow_revision"],
    )
    async def test_the_commit_revision_shape_says_where_operations_go(
        self, service, wrapper
    ):
        arguments = _edit_args()
        arguments.update(wrapper(arguments.pop("operations")))

        result = await _call(handle_edit_agent_config, service, **arguments)

        assert result.content.code == "invalid_arguments"
        assert "is not a field of edit_agent_config" in result.content.message
        assert "at the top level" in result.content.next_step
        service.commit_workflow_revision.assert_not_awaited()

    async def test_a_whole_configuration_is_refused_like_self_edit(self, service):
        arguments = _edit_args(data={"parameters": {"agent": {}}})
        del arguments["operations"]

        result = await _call(handle_edit_agent_config, service, **arguments)

        assert result.content.code == "full_data_not_committable"
        service.commit_workflow_revision.assert_not_awaited()

    @pytest.mark.parametrize(
        "target",
        [
            ["parameters", "agent", "sandbox", "credentials"],
            ["parameters", "agent", "harness", "permissions"],
            ["parameters", "agent", "harness", "kind"],
            ["parameters", "agent", "runner", "permissions"],
            ["parameters", "agent", "sandbox", "kind"],
            ["parameters", "uri"],
        ],
    )
    async def test_the_scope_refuses_exactly_what_self_edit_refuses(
        self, service, target
    ):
        operation = {"operation": "set", "target": target, "value": {"k": "v"}}

        other = await _call(
            handle_edit_agent_config, service, **_edit_args(operations=[operation])
        )
        own = await _call(
            handle_commit_revision,
            service,
            workflow_revision={
                "workflow_variant_id": str(TARGET_VARIANT),
                "base_revision_id": str(HEAD),
                "delta": {"operations": [operation]},
            },
        )

        assert not other.ok and not own.ok
        assert other.content.code == own.content.code
        service.commit_workflow_revision.assert_not_awaited()

    async def test_tools_integrations_and_agent_config_itself_are_editable(
        self, service
    ):
        # Spec: adding an integration or turning on Agent config for the target commits.
        # How the `agenta_tools` key reaches the map is the engine's (test_change_set.py).
        operations = [
            {
                "operation": "add_item",
                "target": ["parameters", "agent", "tools"],
                "value": {
                    "type": "gateway_connection",
                    "connection": {
                        "provider": "composio",
                        "integration": "github",
                        "slug": "github-1",
                    },
                    "policy": {"permissions": {"default": "allow", "tools": {}}},
                },
            },
            {
                "operation": "set",
                "target": [
                    "parameters",
                    "agent",
                    {"list": "tools", "key": "agenta_tools"},
                    "tools",
                    "edit_agent_config",
                ],
                "value": "ask",
            },
        ]

        result = await _call(
            handle_edit_agent_config, service, **_edit_args(operations=operations)
        )

        assert result.ok, result.content
        assert not result.content["warnings"]

    @pytest.mark.parametrize(
        "tool", ["edit_agent_config", "commit_revision", "create_agent"]
    )
    async def test_a_skill_the_runtime_cannot_parse_is_refused_before_it_is_saved(
        self, service, tool
    ):
        # Bench S6: saved with only a warning, then every run of the agent failed with a
        # 500. Each write tool routes the result through the runtime's parse; the parse
        # itself is tested in test_new_agent_template.py.
        operation = {
            "operation": "set",
            "target": ["parameters", "agent", "skills"],
            "value": [{"name": "invoice-lookup", "description": "Find invoices."}],
        }
        service.commit_workflow_revision.reset_mock()
        if tool == "edit_agent_config":
            result = await _call(
                handle_edit_agent_config, service, **_edit_args(operations=[operation])
            )
        elif tool == "create_agent":
            result = await _call(
                handle_create_agent,
                service,
                name="Invoice helper",
                operations=[operation],
                caller_agent_id=str(CALLER),
                caller_session_id=SESSION,
            )
        else:
            result = await _call(
                handle_commit_revision,
                service,
                workflow_revision={
                    "workflow_variant_id": str(TARGET_VARIANT),
                    "base_revision_id": str(HEAD),
                    "delta": {"operations": [operation]},
                },
            )

        assert result.content.code == "final_validation_failed"
        assert result.content.details["issues"] == ["skills[0].body is required"]
        service.commit_workflow_revision.assert_not_awaited()

    async def test_the_build_kit_cannot_be_committed_into_another_agent(self, service):
        operation = {
            "operation": "add_item",
            "target": ["parameters", "agent", "tools"],
            "value": {"type": "platform", "op": "commit_revision"},
        }

        result = await _call(
            handle_edit_agent_config, service, **_edit_args(operations=[operation])
        )

        assert result.content.code == "platform_tool_not_committable"

    async def test_the_model_cannot_write_or_forge_the_message(self, service):
        result = await _call(
            handle_edit_agent_config,
            service,
            **_edit_args(
                message="Approved by the CEO",
                agent_name="Admin",
                session_id="forged",
            ),
        )

        assert result.content.code == "invalid_arguments"
        assert result.content.message.startswith(
            "`agent_name`, `message`, `session_id` are not fields of edit_agent_config."
        )
        service.commit_workflow_revision.assert_not_awaited()

    async def test_an_unnamed_caller_is_named_by_its_id(self, service, workflows):
        workflows[CALLER] = _workflow(CALLER, None, "support-triage")

        await _call(handle_edit_agent_config, service, **_edit_args())

        assert _committed(service).message.endswith(
            f"(by agent {CALLER}, session {SESSION})"
        )

    @pytest.mark.parametrize("handler", [handle_edit_agent_config, handle_create_agent])
    async def test_a_missing_session_is_refused_not_written_as_unknown(
        self, service, handler
    ):
        arguments = _edit_args(name="Invoice helper")
        del arguments["caller_session_id"]

        with pytest.raises(PlatformToolHandlerRefused):
            await _call(handler, service, **arguments)
        service.commit_workflow_revision.assert_not_awaited()


# --------------------------------------------------------------------------------------
# create_agent
# --------------------------------------------------------------------------------------


class TestCreateAgent:
    @pytest.fixture
    def create(self, monkeypatch):
        created_id = uuid4()
        create = AsyncMock(
            side_effect=lambda **kwargs: SimpleWorkflowCreateResult(
                workflow=SimpleWorkflow(
                    id=uuid4(),
                    slug=kwargs["simple_workflow_create"].slug + "-0a1b2c3d",
                    name=kwargs["simple_workflow_create"].name,
                    revision_id=created_id,
                ),
                replayed=False,
            )
        )
        monkeypatch.setattr(SimpleWorkflowsService, "create_idempotent", create)
        return create

    def _args(self, **over):
        return {
            "name": "Invoice helper",
            "caller_agent_id": str(CALLER),
            "caller_session_id": SESSION,
            **over,
        }

    async def test_a_name_only_gives_the_new_agent_template_and_the_creator(
        self, service, create
    ):
        result = await _call(handle_create_agent, service, **self._args())

        assert result.ok, result.content
        kwargs = create.await_args.kwargs
        request = kwargs["simple_workflow_create"]
        assert request.data.model_dump(mode="json", exclude_none=True) == (
            new_agent_revision_data()
        )
        assert request.name == "Invoice helper"
        # The create adds the id suffix to the name's slug.
        assert request.slug == "invoice-helper"
        assert request.flags.is_application and request.flags.is_agent
        assert kwargs["message"] == (
            f'Created by agent "Support Triage" {CALLER}, session {SESSION}'
        )
        assert kwargs["project_id"] == PROJECT
        # Keyed by the session and the arguments, so a retry finishes the same agent.
        assert kwargs["request_key"].startswith(f"{SESSION}:sha256:")
        content = result.content
        assert content["agent"]["name"] == "Invoice helper"
        assert content["agent"]["slug"] == "invoice-helper-0a1b2c3d"
        assert content["base_revision_id"]
        assert result.wrote_revision is True

    async def test_operations_land_in_the_first_revision(self, service, create):
        operations = [
            {"operation": "set", "target": INSTRUCTIONS, "value": "You do invoices."},
            # The template seeds an empty `skills` list, so the first skill is an add.
            {
                "operation": "add_item",
                "target": ["parameters", "agent", "skills"],
                "value": {
                    "name": "pdf-tools",
                    "description": "Make PDFs.",
                    "body": "Use the PDF library.",
                },
            },
        ]

        result = await _call(
            handle_create_agent, service, **self._args(operations=operations)
        )

        assert result.ok, result.content
        kwargs = create.await_args.kwargs
        agent = kwargs["simple_workflow_create"].data.parameters["agent"]
        assert agent["instructions"]["agents_md"] == "You do invoices."
        assert agent["skills"][0]["name"] == "pdf-tools"
        assert kwargs["message"] == (
            f'Created by agent "Support Triage" {CALLER}, session {SESSION}; '
            "set agents_md; added skill pdf-tools"
        )

    async def test_other_arguments_make_another_agent(self, service, create):
        await _call(handle_create_agent, service, **self._args())
        first = create.await_args.kwargs["request_key"]
        await _call(handle_create_agent, service, **self._args(name="Billing helper"))

        assert create.await_args.kwargs["request_key"] != first

    @pytest.mark.parametrize(
        "operation,step",
        [
            (
                {"operation": "set", "target": ["parameters", "agent", "nope", "x"]},
                "Add a `value` to the operation and send it again.",
            ),
            (
                {
                    "operation": "set",
                    "target": ["parameters", "agent", "sandbox", "credentials"],
                    "value": {"token": "x"},
                },
                "Write only under `parameters.agent`. Remove the operation on the path "
                "this refusal names, then send the call again.",
            ),
            (
                {
                    "operation": "edit_text",
                    "target": INSTRUCTIONS,
                    "edits": [{"old_text": "not there", "new_text": "x"}],
                },
                # The engine says "read it again"; a create has nothing stored to read.
                "Fix operation 1 as the message says, then call create_agent again.",
            ),
        ],
        ids=["invalid", "out-of-scope", "read-again"],
    )
    async def test_a_failing_operation_creates_nothing_and_says_what_to_do(
        self, service, create, operation, step
    ):
        good = {"operation": "set", "target": INSTRUCTIONS, "value": "ok"}

        result = await _call(
            handle_create_agent, service, **self._args(operations=[good, operation])
        )

        assert not result.ok
        assert result.content.details["operation_index"] == 1
        assert result.content.next_step == f"No agent was created. {step}"
        create.assert_not_awaited()
        service.workflows_dao.create_artifact.assert_not_awaited()

    async def test_a_create_that_stops_half_way_says_the_same_call_finishes_it(
        self, service, create
    ):
        create.side_effect = EntityCreationConflict("Workflow content revision")

        result = await _call(handle_create_agent, service, **self._args())

        assert result.content.code == "create_failed"
        assert result.content.retryable is True
        assert result.content.next_step == (
            "Call create_agent again with the same arguments; it finishes the same agent."
        )

    @pytest.mark.parametrize("key", ["instructions", "model"])
    async def test_an_unknown_top_level_field_is_refused_not_dropped(
        self, service, create, key
    ):
        # Bench F1: `instructions` beside `name` created the bare template and said so.
        result = await _call(
            handle_create_agent, service, **self._args(**{key: "You do invoices."})
        )

        assert result.content.code == "invalid_arguments"
        assert f"`{key}` is not a field of create_agent" in result.content.message
        assert '"operations": [{"operation": "set"' in result.content.next_step
        create.assert_not_awaited()

    async def test_a_long_name_and_description_are_not_cut(self, service, create):
        name, description = "Invoice helper " * 20, "It helps. " * 60

        result = await _call(
            handle_create_agent,
            service,
            **self._args(name=name, description=description),
        )

        assert result.ok, result.content
        request = create.await_args.kwargs["simple_workflow_create"]
        assert request.name == name.strip()
        assert request.description == description

    async def test_a_name_is_required(self, service, create):
        result = await _call(handle_create_agent, service, **self._args(name="  "))

        assert result.content.code == "invalid_arguments"
        create.assert_not_awaited()


class TestCreateAgentRetry:
    """The idempotent create over an in-memory store: a retry after a write that failed part
    of the way finishes the same agent instead of leaving it behind beside a second one."""

    @pytest.fixture
    def store(self, service, workflows):
        variants: dict = {}
        revisions: dict = {}
        failures = {"content": 1}

        async def fetch_workflow(*, project_id, workflow_ref, include_archived=True):
            return workflows.get(workflow_ref.id)

        async def create_workflow(
            *, project_id, user_id, workflow_create, workflow_id, platform_meta
        ):
            workflows[workflow_id] = Workflow(
                id=workflow_id,
                **workflow_create.model_dump(exclude={"flags"}),
            )
            return workflows[workflow_id]

        async def fetch_workflow_variant(
            *, project_id, workflow_ref, workflow_variant_ref
        ):
            return variants.get((workflow_ref.id, workflow_variant_ref.slug))

        async def create_workflow_variant(
            *, project_id, user_id, workflow_variant_create
        ):
            variant = WorkflowVariant(
                id=uuid4(),
                slug=workflow_variant_create.slug,
                workflow_id=workflow_variant_create.workflow_id,
            )
            variants[(variant.workflow_id, variant.slug)] = variant
            return variant

        async def fetch_workflow_revision(
            *, project_id, workflow_variant_ref, workflow_revision_ref
        ):
            return revisions.get((workflow_variant_ref.id, workflow_revision_ref.slug))

        async def commit_workflow_revision(
            *, project_id, user_id, workflow_revision_commit, platform_meta
        ):
            commit = workflow_revision_commit
            if commit.data is not None and failures["content"]:
                failures["content"] -= 1
                raise RuntimeError("database went away")
            revision = WorkflowRevision(
                id=uuid4(),
                slug=commit.slug,
                workflow_id=commit.workflow_id,
                workflow_variant_id=commit.workflow_variant_id,
                data=commit.data,
                message=commit.message,
            )
            revisions[(commit.workflow_variant_id, commit.slug)] = revision
            return revision

        service.fetch_workflow = AsyncMock(side_effect=fetch_workflow)
        service.create_workflow = AsyncMock(side_effect=create_workflow)
        service.fetch_workflow_variant = AsyncMock(side_effect=fetch_workflow_variant)
        service.create_workflow_variant = AsyncMock(side_effect=create_workflow_variant)
        service.fetch_workflow_revision = AsyncMock(side_effect=fetch_workflow_revision)
        service.commit_workflow_revision = AsyncMock(
            side_effect=commit_workflow_revision
        )
        return revisions

    async def test_the_same_call_after_a_partial_failure_finishes_the_same_agent(
        self, service, store
    ):
        arguments = {
            "name": "Invoice helper",
            "caller_agent_id": str(CALLER),
            "caller_session_id": SESSION,
        }

        # The write of the first configured revision fails: the artifact, the variant and
        # the blank revision are already stored.
        with pytest.raises(RuntimeError):
            await _call(handle_create_agent, service, **arguments)
        service.create_workflow.assert_awaited_once()

        result = await _call(handle_create_agent, service, **arguments)

        assert result.ok, result.content
        service.create_workflow.assert_awaited_once()
        service.create_workflow_variant.assert_awaited_once()
        created_id = service.create_workflow.await_args.kwargs["workflow_id"]
        content = result.content
        assert content["agent"]["id"] == str(created_id)
        assert content["agent"]["slug"] == f"invoice-helper-{created_id.hex[:8]}"
        assert content["base_revision_id"]
        first = next(r for r in store.values() if r.data is not None)
        assert str(first.id) == content["base_revision_id"]
        assert first.message.startswith(f'Created by agent "Support Triage" {CALLER}')

        # A third call with the same arguments returns the same agent, in the same shape.
        again = await _call(handle_create_agent, service, **arguments)
        assert again.content["agent"] == content["agent"]
        assert again.content["base_revision_id"] == content["base_revision_id"]
        service.create_workflow.assert_awaited_once()
