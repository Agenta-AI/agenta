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
from uuid import UUID, uuid4

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
from oss.src.core.workflows.dtos import (
    SimpleWorkflow,
    Workflow,
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowRevisionFlags,
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
                    "tools": [],
                    "sandbox": {"kind": "local", "credentials": {"x": "y"}},
                }
            },
        ),
    )


@pytest.fixture(autouse=True)
def _no_cache(monkeypatch):
    monkeypatch.setattr(platform_handlers, "invalidate_cache", AsyncMock())


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
    @pytest.fixture
    def listing(self, service, workflows):
        caller_head = _head(workflow_id=CALLER)
        target_head = _head()
        second_variant = _head()  # the same agent's other variant
        service.query_workflow_head_revisions = AsyncMock(
            return_value=[target_head, second_variant, caller_head]
        )
        service.query_workflows = AsyncMock(return_value=list(workflows.values()))
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

    async def test_queries_agents_only_in_the_credential_project(self, listing):
        # A project in the arguments is not a parameter; the credential decides.
        await _call(handle_list_agents, listing, project_id=str(uuid4()))

        kwargs = listing.query_workflow_head_revisions.await_args.kwargs
        assert kwargs["project_id"] == PROJECT
        assert kwargs["workflow_revision_query"].flags.is_agent is True
        assert kwargs["include_archived"] is False
        assert listing.query_workflows.await_args.kwargs["project_id"] == PROJECT

    async def test_a_full_page_hands_back_a_cursor_that_fetches_the_next(self, listing):
        first = await _call(handle_list_agents, listing, limit=3)
        cursor = first.content["next_cursor"]
        assert cursor == str(HEAD)

        await _call(handle_list_agents, listing, limit=3, cursor=cursor)
        windowing = listing.query_workflow_head_revisions.await_args.kwargs["windowing"]
        assert str(windowing.next) == cursor and windowing.limit == 3

    async def test_archived_agents_only_on_request_and_marked(self, listing, workflows):
        workflows[TARGET] = _workflow(TARGET, "Old", "old", archived=True)
        listing.query_workflows.return_value = list(workflows.values())

        result = await _call(handle_list_agents, listing, include_archived=True)

        assert (
            listing.query_workflow_head_revisions.await_args.kwargs["include_archived"]
            is True
        )
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
        service.read_workflow_revision_config = AsyncMock(return_value=_read_outcome())

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
            (_head(), "__ag__build_kit", "agent_is_static"),
            (_head(is_static=True), STATIC_ID, "agent_is_static"),
            (_head(archived=True), "invoice-helper-k3x9", "agent_archived"),
            (_head(is_agent=False), "invoice-helper-k3x9", "not_an_agent"),
        ],
        ids=["static-slug", "static-id", "archived", "not-an-agent"],
    )
    @pytest.mark.parametrize(
        "handler", [handle_read_agent_config, handle_edit_agent_config]
    )
    async def test_refused_targets_touch_nothing(
        self, service, handler, head, agent, code
    ):
        service.fetch_workflow_revision.return_value = head
        service.read_workflow_revision_config = AsyncMock()

        result = await _call(handler, service, **_edit_args(agent=agent))

        assert not result.ok
        assert result.content.code == code
        assert result.content.next_step
        service.read_workflow_revision_config.assert_not_awaited()
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


def _read_outcome():
    from oss.src.core.workflows.service import ConfigReadOutcome

    return ConfigReadOutcome(
        revision=_head(),
        path=["parameters", "agent", "llm"],
        value={"model": "gpt"},
        bytes=16,
        is_draft=False,
        warnings=[],
    )


class TestReadAgentConfig:
    async def test_answers_like_read_config_from_the_target_head(self, service):
        service.read_workflow_revision_config = AsyncMock(return_value=_read_outcome())

        result = await _call(
            handle_read_agent_config,
            service,
            agent="invoice-helper-k3x9",
            path=["parameters", "agent", "llm"],
            max_bytes=2048,
            caller_agent_id=str(CALLER),
        )

        kwargs = service.read_workflow_revision_config.await_args.kwargs
        assert kwargs == {
            "project_id": PROJECT,
            "workflow_variant_id": TARGET_VARIANT,
            "path": ["parameters", "agent", "llm"],
            "max_bytes": 2048,
        }
        content = result.content
        assert content.base_revision_id == str(HEAD)
        assert content.value == {"model": "gpt"}
        # The draft warning is about the caller's run, not about this agent.
        assert content.is_draft is False and not content.warnings

    async def test_a_value_over_the_limit_lists_children(self, service):
        from oss.src.core.workflows.read_config import ReadConfigError

        service.read_workflow_revision_config = AsyncMock(
            side_effect=ReadConfigError(
                "output_too_large",
                "Too large.",
                children=["instructions", "tools"],
            )
        )

        result = await _call(
            handle_read_agent_config,
            service,
            agent="invoice-helper-k3x9",
            caller_agent_id=str(CALLER),
        )

        assert result.content.code == "output_too_large"
        assert result.content.details["children"] == ["instructions", "tools"]


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
        # Another agent's write: no self-commit signal for the caller's playground.
        assert result.committed_revision is None
        platform_handlers.invalidate_cache.assert_awaited_once()

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
            # An `agenta_tools` entry has no key to select it by, so turning Agent config
            # on means setting the list, the same as it does for a self-edit.
            {
                "operation": "set",
                "target": ["parameters", "agent", "tools"],
                "value": [
                    {
                        "type": "agenta_tools",
                        "tools": {
                            "read_agent_config": "allow",
                            "create_agent": "allow",
                            "edit_agent_config": "allow",
                        },
                    },
                ],
            },
        ]

        result = await _call(
            handle_edit_agent_config, service, **_edit_args(operations=operations)
        )

        assert result.ok, result.content
        tools = _committed(service).data.parameters["agent"]["tools"]
        assert tools[0]["tools"]["edit_agent_config"] == "allow"

        result = await _call(
            handle_edit_agent_config, service, **_edit_args(operations=operations[:1])
        )
        assert result.ok, result.content
        tools = _committed(service).data.parameters["agent"]["tools"]
        assert tools[0]["type"] == "gateway_connection"

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

        assert result.ok
        message = _committed(service).message
        assert "CEO" not in message and "Admin" not in message
        assert "forged" not in message
        assert message.endswith(
            f'(by agent "Support Triage" {CALLER}, session {SESSION})'
        )

    async def test_a_run_without_a_session_or_a_named_caller_says_so(
        self, service, workflows
    ):
        workflows[CALLER] = _workflow(CALLER, None, "support-triage")
        arguments = _edit_args()
        del arguments["caller_session_id"]

        await _call(handle_edit_agent_config, service, **arguments)

        assert _committed(service).message.endswith(
            f"(by agent {CALLER}, session none)"
        )


# --------------------------------------------------------------------------------------
# create_agent
# --------------------------------------------------------------------------------------


class TestCreateAgent:
    @pytest.fixture
    def create(self, monkeypatch):
        created_id = uuid4()
        create = AsyncMock(
            side_effect=lambda **kwargs: SimpleWorkflow(
                id=kwargs["workflow_id"],
                slug=kwargs["simple_workflow_create"].slug,
                name=kwargs["simple_workflow_create"].name,
                revision_id=created_id,
            )
        )
        monkeypatch.setattr(SimpleWorkflowsService, "create", create)
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
        assert request.slug.startswith("invoice-helper-")
        assert request.flags.is_application and request.flags.is_agent
        assert kwargs["message"] == (
            f'Created by agent "Support Triage" {CALLER}, session {SESSION}'
        )
        assert kwargs["project_id"] == PROJECT
        content = result.content
        assert content["agent"]["name"] == "Invoice helper"
        assert content["base_revision_id"]
        platform_handlers.invalidate_cache.assert_awaited_once()

    async def test_operations_land_in_the_first_revision(self, service, create):
        operations = [
            {"operation": "set", "target": INSTRUCTIONS, "value": "You do invoices."},
            # The template has no `skills` list yet, so the first skill sets the list.
            {
                "operation": "set",
                "target": ["parameters", "agent", "skills"],
                "value": [
                    {
                        "name": "pdf-tools",
                        "description": "Make PDFs.",
                        "body": "Use the PDF library.",
                    }
                ],
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
            "set agents_md; set skills"
        )

    @pytest.mark.parametrize(
        "operation,code",
        [
            (
                {"operation": "set", "target": ["parameters", "agent", "nope", "x"]},
                "missing_operation_value",
            ),
            (
                {
                    "operation": "set",
                    "target": ["parameters", "agent", "sandbox", "credentials"],
                    "value": {"token": "x"},
                },
                None,
            ),
        ],
        ids=["invalid", "out-of-scope"],
    )
    async def test_a_failing_operation_creates_nothing_and_names_it(
        self, service, create, operation, code
    ):
        good = {"operation": "set", "target": INSTRUCTIONS, "value": "ok"}

        result = await _call(
            handle_create_agent, service, **self._args(operations=[good, operation])
        )

        assert not result.ok
        if code:
            assert result.content.code == code
        assert result.content.details["operation_index"] == 1
        create.assert_not_awaited()
        service.workflows_dao.create_artifact.assert_not_awaited()

    async def test_a_create_that_fails_half_way_is_archived(self, service, create):
        create.side_effect = None
        create.return_value = None
        service.archive_workflow = AsyncMock()

        result = await _call(handle_create_agent, service, **self._args())

        assert result.content.code == "create_failed"
        created_id = create.await_args.kwargs["workflow_id"]
        assert service.archive_workflow.await_args.kwargs["workflow_id"] == created_id

    async def test_a_name_is_required(self, service, create):
        result = await _call(handle_create_agent, service, **self._args(name="  "))

        assert result.content.code == "invalid_arguments"
        create.assert_not_awaited()
