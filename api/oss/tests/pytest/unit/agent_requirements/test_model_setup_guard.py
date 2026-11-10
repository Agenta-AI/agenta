"""Turning on an automation is refused only while the agent's model needs setup."""

from types import SimpleNamespace
from typing import Any, List
from uuid import uuid4

import pytest

from oss.src.core.agent_requirements.guard import (
    AgentNeedsSetupRefused,
    ModelSetupGuard,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.utils.context import (
    ApiKeyCredentials,
    AuthContext,
    AuthScope,
    reset_auth_context,
    set_auth_context,
)


class _Workflows:
    def __init__(self, parameters: Any):
        self.parameters = parameters

    async def fetch_request_revision(self, *, project_id, request):
        return SimpleNamespace(
            artifact_id=uuid4(), data=SimpleNamespace(parameters=self.parameters)
        )


class _Sharing:
    def __init__(self, policy: Any = None):
        self.policy = policy

    async def fetch_agent_policy_cached(self, *, project_id, artifact_id):
        return SimpleNamespace(policy=self.policy)


class _Requirements:
    def __init__(self, requirements: List[Any]):
        self.requirements = requirements
        self.calls = 0

    async def model_requirements(
        self, *, scope, parameters, artifact_id, run_person_id
    ):
        self.calls += 1
        self.run_person_id = run_person_id
        return self.requirements


@pytest.fixture
def sharing(monkeypatch):
    from oss.src.core.agent_requirements import guard as guard_module

    value = _Sharing()
    monkeypatch.setattr(guard_module, "get_sharing_service", lambda: value)
    return value


@pytest.fixture
def scope(sharing):
    value = AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )
    token = set_auth_context(
        AuthContext(credentials=ApiKeyCredentials(value="k"), scope=value)
    )
    yield value
    reset_auth_context(token)


def _requirement() -> Any:
    return SimpleNamespace(
        model_dump=lambda **_: {"key": "model_key:project/gone", "blocks_run": True}
    )


async def test_a_model_that_needs_setup_refuses_the_turn_on(scope):
    guard = ModelSetupGuard(
        workflows_service=_Workflows({"agent": {}}),
        requirements_service=_Requirements([_requirement()]),
    )
    with pytest.raises(AgentNeedsSetupRefused) as raised:
        await guard.check(
            project_id=scope.project_id, references={"workflow": {"slug": "a"}}
        )
    envelope = raised.value.envelope()
    assert envelope["code"] == "agent_needs_setup"
    assert envelope["message"] == "The model needs setup before this agent can run."
    assert envelope["details"]["requirements"][0]["key"] == "model_key:project/gone"


async def test_a_ready_model_lets_it_turn_on(scope):
    requirements = _Requirements([])
    guard = ModelSetupGuard(
        workflows_service=_Workflows({"agent": {}}), requirements_service=requirements
    )
    await guard.check(
        project_id=scope.project_id, references={"workflow": {"slug": "a"}}
    )
    assert requirements.calls == 1


class _ChannelsDao:
    def __init__(self, stored: Any):
        self.stored = stored

    async def fetch_agent(self, *, project_id, agent_id):
        return self.stored


class _Guard:
    def __init__(self):
        self.calls = 0

    async def check(self, *, project_id, references, selector=None, run_person_id=None):
        self.calls += 1
        raise AgentNeedsSetupRefused([])


def _binding(*, active: bool, slug: str) -> Any:
    ref = SimpleNamespace(model_dump=lambda **_: {"slug": slug})
    return SimpleNamespace(
        id=uuid4(),
        flags=SimpleNamespace(is_active=active),
        data=SimpleNamespace(references={"workflow": ref}),
    )


def _channels(stored: Any, guard: Any) -> ChannelsService:
    service = object.__new__(ChannelsService)
    service.channels_dao = _ChannelsDao(stored)
    service.needs_setup_guard = guard
    return service


@pytest.mark.parametrize(
    "stored, edit, refused",
    [
        # Turning a binding on is checked.
        ("inactive", "active", True),
        # A rename of a binding that is already on, same agent: never refused.
        ("active", "active", False),
        # Turning it off: never refused.
        ("active", "inactive", False),
    ],
)
async def test_a_channel_edit_is_checked_only_when_it_turns_a_binding_on(
    stored, edit, refused
):
    guard = _Guard()
    same = _binding(active=stored == "active", slug="a")
    edited = _binding(active=edit == "active", slug="a")
    edited.data.references = same.data.references
    service = _channels(same, guard)

    if refused:
        with pytest.raises(AgentNeedsSetupRefused):
            await service._check_needs_setup(
                project_id=uuid4(),
                agent=edited,
                stored=same,
            )
    else:
        await service._check_needs_setup(
            project_id=uuid4(),
            agent=edited,
            stored=same,
        )
    assert guard.calls == (1 if refused else 0)


async def test_pointing_an_active_binding_at_another_agent_is_checked():
    guard = _Guard()
    stored = _binding(active=True, slug="a")
    edited = _binding(active=True, slug="b")
    with pytest.raises(AgentNeedsSetupRefused):
        await _channels(stored, guard)._check_needs_setup(
            project_id=uuid4(),
            agent=edited,
            stored=stored,
        )


async def test_an_edit_that_turns_a_binding_on_is_refused_before_the_write(monkeypatch):
    """Through the write path itself: `_edit_agent_row` runs the check, so the DAO never
    writes a binding of an agent whose model needs setup."""
    guard = _Guard()
    stored = _binding(active=False, slug="a")
    edited = _binding(active=True, slug="a")
    edited.id = stored.id
    edited.data.references = stored.data.references
    service = _channels(stored, guard)
    writes: List[Any] = []

    async def _no_guard(**_kwargs):
        return None

    async def _edit_agent(**kwargs):
        writes.append(kwargs)

    monkeypatch.setattr(service, "_activation_guard", _no_guard)
    service.channels_dao.edit_agent = _edit_agent

    with pytest.raises(AgentNeedsSetupRefused):
        await service._edit_agent_row(
            project_id=uuid4(), user_id=uuid4(), guard_user_id=uuid4(), agent=edited
        )
    assert writes == [] and guard.calls == 1


async def test_another_persons_private_agent_is_not_checked(scope, sharing):
    """The answer would name that agent's items; the write's owner rule refuses it."""
    from oss.src.core.sharing.dtos import Visibility

    sharing.policy = SimpleNamespace(
        visibility=Visibility.PRIVATE, owner_user_id=uuid4()
    )
    requirements = _Requirements([_requirement()])
    guard = ModelSetupGuard(
        workflows_service=_Workflows({"agent": {}}), requirements_service=requirements
    )
    await guard.check(
        project_id=scope.project_id, references={"workflow": {"slug": "a"}}
    )
    assert requirements.calls == 0


async def test_an_api_key_of_the_owner_does_not_see_a_private_agent(
    scope, sharing, monkeypatch
):
    """Only the owner as a person passes the private-agent rule, never their API key."""
    from oss.src.core.agent_requirements import guard as guard_module
    from oss.src.core.sharing.dtos import Visibility

    sharing.policy = SimpleNamespace(
        visibility=Visibility.PRIVATE, owner_user_id=scope.user_id
    )
    api_key = SimpleNamespace(principal=SimpleNamespace(kind="api_key", id=uuid4()))
    monkeypatch.setattr(guard_module, "get_request_access", lambda: api_key)
    requirements = _Requirements([_requirement()])
    guard = ModelSetupGuard(
        workflows_service=_Workflows({"agent": {}}), requirements_service=requirements
    )
    await guard.check(
        project_id=scope.project_id, references={"workflow": {"slug": "a"}}
    )
    assert requirements.calls == 0


async def test_the_guard_checks_for_the_person_the_automation_runs_as(scope):
    requirements = _Requirements([])
    guard = ModelSetupGuard(
        workflows_service=_Workflows({"agent": {}}), requirements_service=requirements
    )
    person = uuid4()
    await guard.check(
        project_id=scope.project_id,
        references={"workflow": {"slug": "a"}},
        run_person_id=person,
    )
    assert requirements.run_person_id == person


class _RecordingGuard:
    def __init__(self):
        self.run_person_ids: List[Any] = []

    async def check(self, *, project_id, references, selector=None, run_person_id=None):
        self.run_person_ids.append(run_person_id)


@pytest.mark.parametrize("kind", ["human", "api_key"])
async def test_a_trigger_turn_on_checks_for_its_run_person(kind):
    """A schedule or subscription runs as its stored principal; only a person is a run
    person, so an API key's automation is checked with none."""
    from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, RunOrigin
    from oss.src.core.access.principals import stored_work_envelope
    from oss.src.core.triggers.service import TriggersService

    principal = PrincipalRef(kind=PrincipalKind(kind), id=uuid4())
    project_id = uuid4()
    envelope = stored_work_envelope(
        principal=principal,
        organization_id=uuid4(),
        project_id=project_id,
        origin=RunOrigin.SCHEDULE,
        origin_id=str(uuid4()),
        created_by_id=uuid4(),
    )
    service = object.__new__(TriggersService)
    service.needs_setup_guard = _RecordingGuard()
    trigger = SimpleNamespace(
        data=SimpleNamespace(
            references={
                "workflow": SimpleNamespace(model_dump=lambda **_: {"slug": "a"})
            },
            selector=None,
        )
    )
    await service._check_needs_setup(
        project_id=project_id, trigger=trigger, envelope=envelope
    )
    assert service.needs_setup_guard.run_person_ids == [
        principal.id if kind == "human" else None
    ]
