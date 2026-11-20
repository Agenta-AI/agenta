"""The check every session op, drive op and `resolve_gate` passes (design D31): the
calling run comes from the run credential's claims only, its session is rechecked at
every op, and every target is checked for the run authority's own right."""

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.sharing.dtos import AccessPolicy, Visibility
from oss.src.core.tools import platform_handlers
from oss.src.core.tools.dtos import (
    PlatformHandlerResult,
    ToolCall,
    ToolCallData,
    ToolCallFunction,
)
from oss.src.core.tools.platform_handlers import (
    RUN_CREDENTIAL_REQUIRED,
    PlatformToolHandlerRegistration,
    _Refusal,
    caller_may,
    session_caller_of,
)
from oss.tests.pytest.utils.memberships import RecordingRbac
from oss.tests.pytest.utils.principals import (
    InMemoryPrincipalsDAO,
    make_envelope,
    make_request_access,
)
from oss.tests.pytest.utils.sharing import NoopRunAdmission, SharingWorld

STUB_CALL_REF = "tools.agenta.stub_session_op"


class _World:
    """A real `AccessService` over one project. Ana owns a private session; Ben owns
    a project-visible one; Ana also owns a project-visible session."""

    def __init__(self) -> None:
        self.world = SharingWorld()
        self.ana = self.world.add_member(uuid4())
        self.ben = self.world.add_member(uuid4())
        principals = InMemoryPrincipalsDAO()
        for user in (self.ana, self.ben):
            principals.human(user)
        self.access = AccessService(
            memberships=self.world.service._memberships,
            rbac_entitlement=RecordingRbac(),
            principals=principals,
            resource_policy=self.world.service,
        )
        self.ana_private = self.world.add_session(policy=self.private(self.ana))
        self.ana_shared = self.world.add_session(
            policy=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=self.ana)
        )
        self.ben_session = self.world.add_session(
            policy=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=self.ben)
        )

    @staticmethod
    def private(owner) -> AccessPolicy:
        return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)

    def envelope(self, user):
        return make_envelope(
            kind="human",
            principal_id=user,
            project_id=self.world.project_id,
            organization_id=self.world.organization_id,
        )

    def access_of(self, user, *, kind, session_id=None, agent_id=None):
        access = make_request_access(envelope=self.envelope(user), credential_kind=kind)
        return access.model_copy(
            update={"run_session_id": session_id, "run_agent_id": agent_id}
        )


@pytest.fixture
def world(monkeypatch) -> _World:
    import oss.src.core.access.service as access_module

    world = _World()
    monkeypatch.setattr(access_module, "_access_service", world.access)
    return world


async def _refusal(access) -> dict:
    with pytest.raises(_Refusal) as raised:
        await session_caller_of(access)
    return raised.value.error.model_dump(exclude_none=True)


# -- session_caller_of ------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["bearer_session", "api_key"])
async def test_a_browser_session_or_an_api_key_is_refused(world, kind):
    error = await _refusal(
        world.access_of(world.ben, kind=kind, session_id=world.ana_private.session_id)
    )
    assert error == {
        "code": RUN_CREDENTIAL_REQUIRED,
        "message": "Only an agent run can call session tools.",
        "retryable": False,
    }


async def test_no_request_access_is_refused(world):
    assert (await _refusal(None))["code"] == RUN_CREDENTIAL_REQUIRED


async def test_a_run_credential_without_the_claim_is_refused(world):
    """Ben minted a credential that names Ana's private session: it has no claim."""
    error = await _refusal(world.access_of(world.ben, kind="run_credential"))
    assert error["code"] == RUN_CREDENTIAL_REQUIRED
    assert error["message"] == "Only an agent run can call session tools."


async def test_the_caller_comes_from_the_claims(world):
    agent_id = uuid4()
    caller = await session_caller_of(
        world.access_of(
            world.ben,
            kind="run_credential",
            session_id=world.ben_session.session_id,
            agent_id=agent_id,
        )
    )
    assert caller.session_id == world.ben_session.session_id
    assert caller.agent_id == agent_id
    assert caller.envelope.authority.principal.id == world.ben


async def test_a_session_made_private_after_the_mint_is_refused(world):
    """Ben runs in Ana's project-visible session; Ana makes it private."""
    access = world.access_of(
        world.ben, kind="run_credential", session_id=world.ana_shared.session_id
    )
    assert (await session_caller_of(access)).session_id == world.ana_shared.session_id

    key = (world.world.project_id, world.ana_shared.session_id)
    world.world.dao.sessions[key] = world.ana_shared.model_copy(
        update={"policy": world.private(world.ana)}
    )
    error = await _refusal(access)
    assert error["code"] == RUN_CREDENTIAL_REQUIRED
    assert error["message"] == "This session is no longer open to the run's person."


async def test_a_credential_of_another_session_acts_only_as_that_session(world):
    """Ben's run credential names Ben's session; its calling session is Ben's, never
    Ana's, whatever an argument says, and Ana's private session is no target of his."""
    caller = await session_caller_of(
        world.access_of(
            world.ben, kind="run_credential", session_id=world.ben_session.session_id
        )
    )
    assert caller.session_id == world.ben_session.session_id
    assert not await caller_may(
        caller,
        session_id=world.ana_private.session_id,
        action=Permission.RUN_SESSIONS,
    )


async def test_a_hidden_target_session_is_refused_and_a_visible_one_allowed(world):
    caller = await session_caller_of(
        world.access_of(
            world.ben, kind="run_credential", session_id=world.ben_session.session_id
        )
    )
    for action in (Permission.VIEW_SESSIONS, Permission.RUN_SESSIONS):
        assert not await caller_may(
            caller, session_id=world.ana_private.session_id, action=action
        )
        assert await caller_may(
            caller, session_id=world.ana_shared.session_id, action=action
        )


async def test_a_target_right_is_view_or_run_only(world):
    caller = await session_caller_of(
        world.access_of(
            world.ana, kind="run_credential", session_id=world.ana_private.session_id
        )
    )
    with pytest.raises(ValueError):
        await caller_may(
            caller,
            session_id=world.ana_shared.session_id,
            action=Permission.EDIT_SESSIONS,
        )


# -- through /tools/call, with a stub session op ----------------------------------------


@pytest.fixture
def stub_op(monkeypatch):
    calls = []

    async def _handler(*, arguments, session_caller, **_kwargs):
        calls.append({"arguments": arguments, "session_caller": session_caller})
        return PlatformHandlerResult(content={"ok": True})

    monkeypatch.setitem(
        platform_handlers.PLATFORM_TOOL_HANDLERS,
        STUB_CALL_REF,
        PlatformToolHandlerRegistration(
            call_ref=STUB_CALL_REF,
            timeout_ms=1_000,
            handler=_handler,
            needs_session_caller=True,
        ),
    )

    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)
    return calls


async def _call(world, access, *, arguments):
    router = ToolsRouter(
        run_admission=NoopRunAdmission(), tools_service=SimpleNamespace()
    )
    request = SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(world.world.project_id),
            user_id=str(access.acting_user_id),
            run_envelope=access.envelope,
        ),
        headers={},
    )
    body = ToolCall(
        data=ToolCallData(
            id="call_1",
            function=ToolCallFunction(name=STUB_CALL_REF, arguments=arguments),
        )
    )
    token = set_request_access(access)
    try:
        return await router.call_tool(request, body=body)
    finally:
        reset_request_access(token)


@pytest.mark.parametrize("kind", ["bearer_session", "api_key"])
async def test_tools_call_with_a_browser_session_or_an_api_key_answers_run_credential_required(
    world, stub_op, kind
):
    """Ben names Ana's private session as the caller in the body: refused before the
    op runs."""
    response = await _call(
        world,
        world.access_of(world.ben, kind=kind),
        arguments={"caller_session_id": world.ana_private.session_id},
    )
    assert response.call.status.code == "STATUS_CODE_ERROR"
    assert json.loads(response.call.data.content)["code"] == RUN_CREDENTIAL_REQUIRED
    assert stub_op == []


async def test_tools_call_with_a_run_credential_runs_the_op_as_its_session(
    world, stub_op
):
    response = await _call(
        world,
        world.access_of(
            world.ben, kind="run_credential", session_id=world.ben_session.session_id
        ),
        arguments={"caller_session_id": world.ana_private.session_id},
    )
    assert response.call.status.code == "STATUS_CODE_OK"
    (call,) = stub_op
    # The argument is the model's; the calling session is the claim.
    assert call["session_caller"].session_id == world.ben_session.session_id
