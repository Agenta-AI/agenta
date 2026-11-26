"""Every commit path that can make an artifact an agent passes the ownership rule's
owner (CONTRACT section 7, "including agents created by tool calls").

A revision is an agent revision when its URI is the agent builtin, whatever route
commits it, so the simple workflow edit, the application and evaluator commits and the
builder tool's commit all pass the owner on. Without it the first agent revision
through them stays ownerless."""

import dataclasses
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.apis.fastapi.applications.router as applications_router_module
import oss.src.apis.fastapi.evaluators.router as evaluators_router_module
import oss.src.apis.fastapi.tools.router as tools_router_module
import oss.src.apis.fastapi.workflows.router as workflows_router_module
import oss.src.core.tools.platform_handlers as handlers_module
from oss.src.apis.fastapi.applications.models import (
    ApplicationRevisionCommitRequest,
    ApplicationRevisionCreateRequest,
    SimpleApplicationCreateRequest,
    SimpleApplicationEditRequest,
)
from oss.src.apis.fastapi.applications.router import (
    ApplicationsRouter,
    SimpleApplicationsRouter,
)
from oss.src.apis.fastapi.evaluators.models import (
    EvaluatorRevisionCommitRequest,
    EvaluatorRevisionCreateRequest,
    SimpleEvaluatorCreateRequest,
    SimpleEvaluatorEditRequest,
)
from oss.src.apis.fastapi.evaluators.router import (
    EvaluatorsRouter,
    SimpleEvaluatorsRouter,
)
from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.apis.fastapi.workflows.models import SimpleWorkflowEditRequest
from oss.src.apis.fastapi.workflows.router import SimpleWorkflowsRouter
from oss.src.core.applications.dtos import ApplicationRevisionCommit
from oss.src.core.applications.service import ApplicationsService
from oss.src.core.evaluators.dtos import EvaluatorRevisionCommit
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.tools.platform_handlers import (
    COMMIT_REVISION_CALL_REF,
    READ_CONFIG_CALL_REF,
    dispatch_platform_tool_handler,
    handle_commit_revision,
)
from oss.src.core.workflows.dtos import SimpleWorkflowEdit
from oss.src.core.workflows.service import SimpleWorkflowsService
from oss.tests.pytest.utils.principals import make_envelope
from oss.tests.pytest.utils.sharing import (
    NoopRunAdmission,
    register_sharing_service_for_tests,
)


ALICE = uuid4()


@pytest.fixture(autouse=True)
def _sharing(monkeypatch):
    register_sharing_service_for_tests(monkeypatch)
    for module in (
        applications_router_module,
        evaluators_router_module,
        tools_router_module,
        workflows_router_module,
    ):
        monkeypatch.setattr(module, "check_action_access", AsyncMock(return_value=True))
        if hasattr(module, "allow_agent"):
            monkeypatch.setattr(module, "allow_agent", AsyncMock(return_value=True))


def _request(envelope=None):
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(uuid4()),
            user_id=str(uuid4()),
            principal=envelope.authority.principal if envelope else None,
            run_envelope=envelope,
        ),
        headers={},
    )


# The ownership rule (initial_policy) applied to the request's run envelope.
OWNER_CASES = [
    pytest.param(make_envelope(principal_id=ALICE), ALICE, id="web-human"),
    pytest.param(
        make_envelope(kind="api_key", origin="api", sender=None), None, id="api-key"
    ),
    pytest.param(
        make_envelope(kind="installation", origin="installation", sender=None),
        None,
        id="installation",
    ),
    pytest.param(make_envelope(principal_id=ALICE, origin="child"), None, id="child"),
    pytest.param(None, None, id="no-envelope"),
]


def _owner_of(mock):
    return mock.await_args.kwargs["first_agent_owner_user_id"]


# --- services forward the owner ---------------------------------------------------


async def test_simple_workflow_edit_forwards_the_owner():
    workflows_service = AsyncMock()
    workflow = SimpleNamespace(id=uuid4(), name="a", description=None)
    workflows_service.fetch_workflow.return_value = SimpleNamespace(
        id=workflow.id, name="a", description=None, flags=None, meta=None, tags=None
    )
    workflows_service.edit_workflow.return_value = workflow
    workflows_service.fetch_workflow_variant.return_value = SimpleNamespace(id=uuid4())
    workflows_service.commit_workflow_revision.return_value = None

    await SimpleWorkflowsService(workflows_service=workflows_service).edit(
        project_id=uuid4(),
        user_id=ALICE,
        simple_workflow_edit=SimpleWorkflowEdit(
            id=workflow.id,
            data={"uri": "agenta:builtin:agent:v0", "parameters": {}},
        ),
        first_agent_owner_user_id=ALICE,
    )

    assert _owner_of(workflows_service.commit_workflow_revision) == ALICE


@pytest.mark.parametrize(
    "service_class, method, commit_class, artifact_key",
    [
        (
            ApplicationsService,
            "commit_application_revision",
            ApplicationRevisionCommit,
            "application",
        ),
        (
            EvaluatorsService,
            "commit_evaluator_revision",
            EvaluatorRevisionCommit,
            "evaluator",
        ),
    ],
)
async def test_family_commit_forwards_the_owner(
    service_class, method, commit_class, artifact_key
):
    workflows_service = AsyncMock()
    workflows_service.commit_workflow_revision.return_value = None

    await getattr(service_class(workflows_service=workflows_service), method)(
        project_id=uuid4(),
        user_id=ALICE,
        **{f"{artifact_key}_revision_commit": commit_class(slug="r1")},
        first_agent_owner_user_id=ALICE,
    )

    assert _owner_of(workflows_service.commit_workflow_revision) == ALICE


# --- routes derive the owner from the request -------------------------------------


@pytest.mark.parametrize("envelope, owner", OWNER_CASES)
async def test_simple_workflow_edit_route_passes_the_owner(envelope, owner):
    service = AsyncMock()
    service.edit.return_value = None
    router = SimpleWorkflowsRouter(simple_workflows_service=service)
    workflow_id = uuid4()

    await router.edit_simple_workflow(
        _request(envelope),
        workflow_id=workflow_id,
        simple_workflow_edit_request=SimpleWorkflowEditRequest.model_validate(
            {"workflow": {"id": str(workflow_id)}}
        ),
    )

    assert _owner_of(service.edit) == owner


@pytest.mark.parametrize("envelope, owner", OWNER_CASES)
@pytest.mark.parametrize(
    "router_class, route, body_key, body_class, revision_key",
    [
        (
            ApplicationsRouter,
            "create_application_revision",
            "application_revision_create_request",
            ApplicationRevisionCreateRequest,
            "application_revision",
        ),
        (
            ApplicationsRouter,
            "commit_application_revision",
            "application_revision_commit_request",
            ApplicationRevisionCommitRequest,
            "application_revision",
        ),
        (
            EvaluatorsRouter,
            "create_evaluator_revision",
            "evaluator_revision_create_request",
            EvaluatorRevisionCreateRequest,
            "evaluator_revision",
        ),
        (
            EvaluatorsRouter,
            "commit_evaluator_revision",
            "evaluator_revision_commit_request",
            EvaluatorRevisionCommitRequest,
            "evaluator_revision",
        ),
    ],
)
async def test_family_commit_routes_pass_the_owner(
    envelope, owner, router_class, route, body_key, body_class, revision_key
):
    service = AsyncMock()
    service.commit_application_revision.return_value = None
    service.commit_evaluator_revision.return_value = None
    service_key = (
        "applications_service"
        if router_class is ApplicationsRouter
        else "evaluators_service"
    )
    router = router_class(**{service_key: service}, environments_service=AsyncMock())

    await getattr(router, route)(
        _request(envelope),
        **{body_key: body_class.model_validate({revision_key: {"slug": "r1"}})},
    )

    commit = (
        service.commit_application_revision
        if router_class is ApplicationsRouter
        else service.commit_evaluator_revision
    )
    assert _owner_of(commit) == owner


def _simple_application_create():
    return {
        "simple_application_create_request": (
            SimpleApplicationCreateRequest.model_validate(
                {"application": {"slug": "a1"}}
            )
        )
    }


def _simple_application_edit():
    artifact_id = uuid4()
    return {
        "application_id": artifact_id,
        "simple_application_edit_request": SimpleApplicationEditRequest.model_validate(
            {"application": {"id": str(artifact_id)}}
        ),
    }


def _simple_evaluator_create():
    return {
        "simple_evaluator_create_request": SimpleEvaluatorCreateRequest.model_validate(
            {"evaluator": {"slug": "e1"}}
        )
    }


def _simple_evaluator_edit():
    artifact_id = uuid4()
    return {
        "evaluator_id": artifact_id,
        "simple_evaluator_edit_request": SimpleEvaluatorEditRequest.model_validate(
            {"evaluator": {"id": str(artifact_id)}}
        ),
    }


@pytest.mark.parametrize("envelope, owner", OWNER_CASES)
@pytest.mark.parametrize(
    "router_class, service_key, route, kwargs",
    [
        (
            SimpleApplicationsRouter,
            "simple_applications_service",
            "create_simple_application",
            _simple_application_create,
        ),
        (
            SimpleApplicationsRouter,
            "simple_applications_service",
            "edit_simple_application",
            _simple_application_edit,
        ),
        (
            SimpleEvaluatorsRouter,
            "simple_evaluators_service",
            "create_simple_evaluator",
            _simple_evaluator_create,
        ),
        (
            SimpleEvaluatorsRouter,
            "simple_evaluators_service",
            "edit_simple_evaluator",
            _simple_evaluator_edit,
        ),
    ],
)
async def test_simple_family_routes_pass_the_owner(
    envelope, owner, router_class, service_key, route, kwargs
):
    service = AsyncMock()
    service.create.return_value = None
    service.edit.return_value = None
    router = router_class(**{service_key: service})

    await getattr(router, route)(_request(envelope), **kwargs())

    method = service.create if route.startswith("create") else service.edit
    assert _owner_of(method) == owner


# --- the builder tool's commit -----------------------------------------------------


async def test_the_tool_commit_forwards_the_owner():
    service = SimpleNamespace(
        fetch_workflow_variant=AsyncMock(return_value=None),
        commit_workflow_revision_checked=AsyncMock(
            return_value=SimpleNamespace(status="no_change", revision=None, warnings=[])
        ),
    )

    await handle_commit_revision(
        arguments={
            "workflow_revision": {
                "workflow_variant_id": str(uuid4()),
                "delta": {"set": {"parameters": {"agent": {"instructions": "hi"}}}},
            }
        },
        project_id=uuid4(),
        user_id=ALICE,
        workflows_service=service,
        first_agent_owner_user_id=ALICE,
    )

    assert _owner_of(service.commit_workflow_revision_checked) == ALICE


async def test_dispatch_gives_the_owner_to_the_commit_handler_only(monkeypatch):
    seen = {}

    def _recording(call_ref):
        async def handler(**kwargs):
            seen[call_ref] = kwargs

        return handler

    registry = {
        call_ref: dataclasses.replace(registration, handler=_recording(call_ref))
        for call_ref, registration in handlers_module.PLATFORM_TOOL_HANDLERS.items()
    }
    monkeypatch.setattr(handlers_module, "PLATFORM_TOOL_HANDLERS", registry)

    for call_ref in (COMMIT_REVISION_CALL_REF, READ_CONFIG_CALL_REF):
        await dispatch_platform_tool_handler(
            call_ref=call_ref,
            arguments={},
            headers={},
            project_id=uuid4(),
            user_id=ALICE,
            workflows_service=None,
            tracing_service=None,
            run_admission=NoopRunAdmission(),
            agent_owner_user_id=ALICE,
        )

    assert seen[COMMIT_REVISION_CALL_REF]["first_agent_owner_user_id"] == ALICE
    assert "first_agent_owner_user_id" not in seen[READ_CONFIG_CALL_REF]


class _Stop(Exception):
    pass


@pytest.mark.parametrize("envelope, owner", OWNER_CASES)
async def test_the_tools_route_derives_the_owner_from_the_run(
    monkeypatch, envelope, owner
):
    captured = {}

    async def dispatch(**kwargs):
        captured.update(kwargs)
        raise _Stop()

    monkeypatch.setattr(tools_router_module, "dispatch_platform_tool_handler", dispatch)
    router = ToolsRouter(tools_service=AsyncMock(), run_admission=NoopRunAdmission())
    body = SimpleNamespace(
        id="call-1", data=SimpleNamespace(function=SimpleNamespace(arguments={}))
    )

    with pytest.raises(_Stop):
        await router._call_reserved_agenta_tool(
            request=_request(envelope), body=body, call_ref=COMMIT_REVISION_CALL_REF
        )

    assert captured["agent_owner_user_id"] == owner
