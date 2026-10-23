"""`RunAdmission`: the session check (rule S2), the agent check (rules A1, A2), the
`readable` flag of a refusal, and the reference resolution of each entry."""

from types import SimpleNamespace
from typing import List, Optional
from uuid import UUID, uuid4

import pytest

from oss.src.core.access.dtos import PrincipalKind, ResourceKind
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sessions.types import SessionReference
from oss.src.core.sharing.admission import RunAdmission
from oss.src.core.sharing.types import AdmissionDenied
from oss.src.core.workflows.dtos import ResolvedTarget
from oss.src.core.workflows.types import AgentReferenceUnresolved
from oss.tests.pytest.utils.principals import make_envelope
from oss.tests.pytest.utils.sharing import RuleAccessService


pytestmark = pytest.mark.asyncio

_PROJECT = uuid4()
_ALICE = uuid4()
_BOB = uuid4()
_SESSION = "alice-private"
_PRIVATE_AGENT = uuid4()
_PROJECT_AGENT = uuid4()


class _FakeWorkflows:
    """`resolve_agent_artifact_id` and `resolve_request_target` over a slug map."""

    def __init__(self) -> None:
        self.agents = {"private": _PRIVATE_AGENT, "shared": _PROJECT_AGENT}
        self.resolve_agent_calls: List[Optional[list]] = []
        self.resolve_target_calls = 0

    async def resolve_agent_artifact_id(self, *, project_id: UUID, references):
        self.resolve_agent_calls.append(references)
        if not references:
            return None
        slug = references[0].slug
        if slug not in self.agents:
            raise AgentReferenceUnresolved()
        return self.agents[slug]

    async def resolve_request_target(self, *, project_id: UUID, request):
        self.resolve_target_calls += 1
        slug = request.references["workflow"]["slug"]
        return ResolvedTarget(artifact_id=self.agents[slug], revision_id=uuid4())


def _rule(principal, action, resource):
    """Alice owns the private session and the private agent; Bob is a Viewer of the
    session (he may read it, not run it)."""
    if resource is None:
        return True
    if resource.kind == ResourceKind.SESSION and resource.id == _SESSION:
        if principal.id == _ALICE:
            return True
        return principal.id == _BOB and action == Permission.VIEW_SESSIONS and _VIEWER
    if resource.kind == ResourceKind.AGENT and resource.id == str(_PRIVATE_AGENT):
        return principal.id == _ALICE
    return True


_VIEWER = False


def _admission():
    access = RuleAccessService(_rule)
    workflows = _FakeWorkflows()
    return RunAdmission(access_service=access, workflows_service=workflows), (
        access,
        workflows,
    )


def _bob():
    return make_envelope(principal_id=_BOB, project_id=_PROJECT)


def _alice():
    return make_envelope(principal_id=_ALICE, project_id=_PROJECT)


def _refs(slug: str) -> List[SessionReference]:
    return [SessionReference(key="workflow", slug=slug)]


@pytest.fixture(autouse=True)
def _no_viewer():
    globals()["_VIEWER"] = False
    yield
    globals()["_VIEWER"] = False


async def test_existing_session_denied_for_non_member_of_session():
    admission, (access, _) = _admission()
    with pytest.raises(AdmissionDenied) as error:
        await admission.admit(
            envelope=_bob(),
            session_id=_SESSION,
            agent_artifact_id=None,
            boundary="heartbeat",
        )
    assert error.value.readable is False
    assert error.value.boundary == "heartbeat"
    assert [call["action"] for call in access.decide_calls] == [
        Permission.RUN_SESSIONS,
        Permission.VIEW_SESSIONS,
    ]


async def test_viewer_admission_is_readable_denial():
    globals()["_VIEWER"] = True
    admission, _ = _admission()
    with pytest.raises(AdmissionDenied) as error:
        await admission.admit(
            envelope=_bob(),
            session_id=_SESSION,
            agent_artifact_id=None,
            boundary="heartbeat",
        )
    assert error.value.readable is True


async def test_private_agent_denied_at_admission():
    admission, (access, _) = _admission()
    with pytest.raises(AdmissionDenied) as error:
        await admission.admit(
            envelope=_bob(),
            session_id=None,
            agent_artifact_id=_PRIVATE_AGENT,
            boundary="queued_dispatch",
        )
    assert error.value.readable is False
    assert [call["action"] for call in access.decide_calls] == [
        Permission.RUN_WORKFLOWS
    ]


async def test_owner_is_admitted_to_session_and_agent():
    admission, (access, _) = _admission()
    await admission.admit(
        envelope=_alice(),
        session_id=_SESSION,
        agent_artifact_id=_PRIVATE_AGENT,
        boundary="heartbeat",
    )
    assert [
        (call["action"], call["resource"].kind) for call in access.decide_calls
    ] == [
        (Permission.RUN_SESSIONS, ResourceKind.SESSION),
        (Permission.RUN_WORKFLOWS, ResourceKind.AGENT),
    ]
    assert access.decide_calls[0]["principal"].kind == PrincipalKind.HUMAN


async def test_draft_run_checks_session_only():
    admission, (access, workflows) = _admission()
    await admission.admit_request(
        envelope=_alice(),
        session_id=_SESSION,
        project_id=_PROJECT,
        request=SimpleNamespace(references=None),
        boundary="queued_dispatch",
    )
    assert workflows.resolve_target_calls == 0
    assert [call["resource"].kind for call in access.decide_calls] == [
        ResourceKind.SESSION
    ]


async def test_new_session_checks_agent_only():
    admission, (access, workflows) = _admission()
    await admission.admit_turn(
        envelope=_alice(),
        session_id=None,
        project_id=_PROJECT,
        references=_refs("private"),
    )
    assert len(workflows.resolve_agent_calls) == 1
    assert [
        (call["resource"].kind, call["resource"].id) for call in access.decide_calls
    ] == [(ResourceKind.AGENT, str(_PRIVATE_AGENT))]


async def test_admit_turn_lets_an_unresolved_reference_propagate():
    admission, (access, _) = _admission()
    with pytest.raises(AgentReferenceUnresolved):
        await admission.admit_turn(
            envelope=_alice(),
            session_id=_SESSION,
            project_id=_PROJECT,
            references=_refs("archived"),
        )
    assert access.decide_calls == []


async def test_admit_request_resolves_once():
    admission, (access, workflows) = _admission()
    request = SimpleNamespace(references={"workflow": {"slug": "private"}})
    with pytest.raises(AdmissionDenied):
        await admission.admit_request(
            envelope=_bob(),
            session_id=None,
            project_id=_PROJECT,
            request=request,
            boundary="api_invoke",
        )
    assert workflows.resolve_target_calls == 1
    # The stored session references are never read: only the request's target.
    assert workflows.resolve_agent_calls == []
    assert [call["resource"].kind for call in access.decide_calls] == [
        ResourceKind.AGENT
    ]


async def test_refusal_logs_ids_and_kinds_only(monkeypatch):
    import oss.src.core.sharing.admission as admission_module

    logged = []
    monkeypatch.setattr(
        admission_module.log,
        "info",
        lambda message, **fields: logged.append((message, fields)),
    )
    admission, _ = _admission()
    with pytest.raises(AdmissionDenied):
        await admission.admit(
            envelope=_bob(),
            session_id=_SESSION,
            agent_artifact_id=None,
            boundary="heartbeat",
        )
    assert logged and logged[0][0] == "[sharing] admission refused"
    fields = logged[0][1]
    assert fields["boundary"] == "heartbeat"
    assert fields["origin"] == "web"
    assert fields["principal_id"] == str(_BOB)
    assert fields["resource_id"] == _SESSION
    assert fields["reason"] == "resource_denied"


async def test_session_readable_is_one_view_decision():
    admission, (access, _) = _admission()
    assert await admission.session_readable(envelope=_alice(), session_id=_SESSION)
    assert not await admission.session_readable(envelope=_bob(), session_id=_SESSION)
    globals()["_VIEWER"] = True
    assert await admission.session_readable(envelope=_bob(), session_id=_SESSION)
    assert [call["action"] for call in access.decide_calls] == [
        Permission.VIEW_SESSIONS
    ] * 3
    assert {call["resource"].id for call in access.decide_calls} == {_SESSION}


async def test_admission_and_invoke_prelude_resolve_the_target_once(monkeypatch):
    """The real `WorkflowsService`: `admit_request` resolves the request's target
    (`resolve_request_target` -> `_ensure_request_revision`) and leaves the revision
    on the request; the invoke prelude (`_prepare_invoke`) then finds it and does
    not resolve again. One revision lookup per boundary run."""

    from unittest.mock import AsyncMock

    import oss.src.core.workflows.service as workflows_service_module
    from oss.src.core.workflows.dtos import (
        WorkflowRevision,
        WorkflowRevisionData,
        WorkflowServiceRequest,
        WorkflowServiceRequestData,
    )
    from oss.src.core.workflows.service import WorkflowsService
    from oss.src.middlewares import auth as auth_module
    from oss.tests.pytest.utils.principals import register_allowing_access_service

    register_allowing_access_service(monkeypatch)  # the prelude's acting user
    monkeypatch.setattr(
        auth_module, "_SECRET_KEY", "unit-test-secret-key-with-32-bytes"
    )
    organization_id = uuid4()
    monkeypatch.setattr(
        workflows_service_module,
        "get_project_by_id",
        AsyncMock(
            return_value=SimpleNamespace(
                workspace_id=uuid4(), organization_id=organization_id
            )
        ),
    )
    service = WorkflowsService(workflows_dao=AsyncMock())
    revision = WorkflowRevision(
        id=uuid4(),
        artifact_id=_PROJECT_AGENT,
        variant_id=uuid4(),
        slug="shared-v1",
        data=WorkflowRevisionData(url="http://services/agent"),
    )
    service.retrieve_workflow_revision = AsyncMock(return_value=(revision, None, None))
    service.fetch_workflow = AsyncMock(return_value=SimpleNamespace(deleted_at=None))
    service._stamp_session_context = AsyncMock()
    admission = RunAdmission(
        access_service=RuleAccessService(lambda *_: True), workflows_service=service
    )
    envelope = make_envelope(
        principal_id=_ALICE, project_id=_PROJECT, organization_id=organization_id
    )
    request = WorkflowServiceRequest(
        references={"workflow": {"id": str(_PROJECT_AGENT)}},
        data=WorkflowServiceRequestData(inputs={}),
    )

    await admission.admit_request(
        envelope=envelope,
        session_id=None,
        project_id=_PROJECT,
        request=request,
        boundary="queued_dispatch",
    )
    await service._prepare_invoke(
        project_id=_PROJECT,
        user_id=_ALICE,
        request=request,
        envelope=envelope,
    )

    service.retrieve_workflow_revision.assert_awaited_once()
