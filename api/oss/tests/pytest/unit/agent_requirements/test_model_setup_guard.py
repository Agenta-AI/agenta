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
        return SimpleNamespace(data=SimpleNamespace(parameters=self.parameters))


class _Requirements:
    def __init__(self, requirements: List[Any]):
        self.requirements = requirements
        self.calls = 0

    async def model_requirements(self, *, scope, parameters):
        self.calls += 1
        return self.requirements


@pytest.fixture
def scope():
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

    async def check(self, *, project_id, references, selector=None):
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
                project_id=uuid4(), agent=edited, stored=same
            )
    else:
        await service._check_needs_setup(project_id=uuid4(), agent=edited, stored=same)
    assert guard.calls == (1 if refused else 0)


async def test_pointing_an_active_binding_at_another_agent_is_checked():
    guard = _Guard()
    stored = _binding(active=True, slug="a")
    edited = _binding(active=True, slug="b")
    with pytest.raises(AgentNeedsSetupRefused):
        await _channels(stored, guard)._check_needs_setup(
            project_id=uuid4(), agent=edited, stored=stored
        )
