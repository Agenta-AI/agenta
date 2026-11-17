"""The drive rule (D1, D2, the legacy branch, the channel exception), the home rule,
and the visibility change that shares an agent's drives (design Decision 4)."""

from contextlib import contextmanager
from typing import Optional
from uuid import UUID, uuid4

import pytest

from oss.src.core.access.context import get_request_memo
from oss.src.core.access.dtos import (
    DecisionReason,
    PrincipalKind,
    PrincipalRecord,
    PrincipalRef,
    RequestAccess,
    RequestCredentialKind,
    ResourceKind,
    ResourceRef,
    RunAuthority,
    RunContext,
    RunOrigin,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.prefetch import request_memo_scope
from oss.src.core.mounts.agent_drives import agent_drive_slug, fill_agent_drive_keys
from oss.src.core.sharing.dtos import AccessPolicy, Visibility
from oss.src.core.sharing.service import SharingService
from oss.src.core.sharing.types import HOME_DRIVE_NOT_ALLOWED
from oss.src.core.sharing.types import DriveNotOwned, HomeDriveNotAllowed
from oss.tests.pytest.utils.sharing import SharingWorld

DENIED = DecisionReason.RESOURCE_DENIED


def _human(user_id) -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


def _private(owner) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


def _shared(owner=None) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=owner)


_CHANNEL_TURN = RunContext(origin=RunOrigin.INSTALLATION)


class _World:
    def __init__(self) -> None:
        self.world = SharingWorld()
        self.alice = self.world.add_member(uuid4())
        self.bob = self.world.add_member(uuid4())
        self.service = self.world.service
        self.dao = self.world.dao
        self.project_id = self.world.project_id

    def drive(self, policy=None, **kwargs):
        return self.dao.add_mount(project_id=self.project_id, policy=policy, **kwargs)

    def agent(self, policy=None) -> UUID:
        return self.dao.add_agent(project_id=self.project_id, policy=policy)

    async def evaluate(
        self, principal, drive, action=Permission.USE_MOUNTS, context=None
    ):
        return await self.service.evaluate(
            principal=principal,
            action=action,
            project_id=self.project_id,
            resource=ResourceRef(kind=ResourceKind.MOUNT, id=str(drive.mount_id)),
            context=context,
        )


@pytest.fixture
def w() -> _World:
    return _World()


@contextmanager
def _channel_request(principal: PrincipalRef, *, creator, run_agent_id: Optional[UUID]):
    """A request of a channel binding created by `creator`, whose run credential names
    `run_agent_id`."""
    from oss.src.core.access import context as access_context  # noqa: PLC0415

    with request_memo_scope():
        get_request_memo()[("principal", principal)] = PrincipalRecord(
            principal=principal, acting_user_id=creator, is_active=True
        )
        access = RequestAccess(
            principal=principal,
            authority=RunAuthority(
                principal=principal, organization_id=uuid4(), project_id=uuid4()
            ),
            credential_kind=RequestCredentialKind.RUN_CREDENTIAL,
            acting_user_id=creator,
            run_agent_id=run_agent_id,
        )
        token = access_context._request_access.set(access)
        try:
            yield
        finally:
            access_context._request_access.reset(token)


# -- D1, D2, the legacy branch -----------------------------------------------------------


async def test_d1_a_shared_drive_lets_the_role_decide(w):
    drive = w.drive(_shared())
    for principal in (
        _human(w.alice),
        PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4()),
    ):
        assert await w.evaluate(principal, drive) is None


async def test_d2_a_private_drive_is_only_its_owners(w):
    drive = w.drive(_private(w.alice))
    assert await w.evaluate(_human(w.alice), drive) is None
    assert await w.evaluate(_human(w.bob), drive) == DENIED
    api_key = PrincipalRef(kind=PrincipalKind.API_KEY, id=w.alice)
    assert await w.evaluate(api_key, drive) == DENIED


async def test_the_legacy_branch_follows_the_agent(w):
    private_agent = w.agent(_private(w.alice))
    drive = w.drive(None, agent_id=private_agent)
    assert await w.evaluate(_human(w.alice), drive) is None
    assert await w.evaluate(_human(w.bob), drive) == DENIED

    shared_agent = w.agent(None)
    open_drive = w.drive(None, agent_id=shared_agent)
    assert await w.evaluate(_human(w.bob), open_drive) is None


async def test_a_drive_without_row_or_agent_reads_as_shared(w):
    assert await w.evaluate(_human(w.bob), w.drive(None)) is None


async def test_an_unknown_drive_is_left_to_the_routes_not_found(w):
    assert (
        await w.service.evaluate(
            principal=_human(w.bob),
            action=Permission.USE_MOUNTS,
            project_id=w.project_id,
            resource=ResourceRef(kind=ResourceKind.MOUNT, id=str(uuid4())),
        )
        is None
    )
    assert (
        await w.service.evaluate(
            principal=_human(w.bob),
            action=Permission.USE_MOUNTS,
            project_id=w.project_id,
            resource=ResourceRef(kind=ResourceKind.MOUNT, id="not-a-uuid"),
        )
        == DENIED
    )


async def test_a_session_drive_follows_its_session(w):
    state = w.world.add_session(policy=_private(w.alice))
    drive = w.drive(None, session_id=state.session_id)
    assert await w.evaluate(_human(w.alice), drive) is None
    assert await w.evaluate(_human(w.bob), drive) == DENIED


# -- the channel exception ----------------------------------------------------------------


async def test_a_channel_turn_signs_its_owners_private_drive(w):
    agent = w.agent(_private(w.alice))
    drive = w.drive(_private(w.alice))
    binding = PrincipalRef(kind=PrincipalKind.INSTALLATION, id=uuid4())
    with _channel_request(binding, creator=w.alice, run_agent_id=agent):
        assert await w.evaluate(binding, drive, context=_CHANNEL_TURN) is None


@pytest.mark.parametrize(
    "case",
    [
        "no_claim",
        "shared_agent",
        "other_creator",
        "other_drive_owner",
        "not_a_sign",
        "not_a_channel_turn",
    ],
)
async def test_each_channel_condition_is_needed(w, case):
    agent = w.agent(_shared(w.alice) if case == "shared_agent" else _private(w.alice))
    drive = w.drive(_private(w.bob if case == "other_drive_owner" else w.alice))
    binding = PrincipalRef(kind=PrincipalKind.INSTALLATION, id=uuid4())
    creator = w.bob if case == "other_creator" else w.alice
    run_agent_id = None if case == "no_claim" else agent
    action = Permission.VIEW_MOUNTS if case == "not_a_sign" else Permission.USE_MOUNTS
    # A child run of a channel turn is no channel turn.
    context = (
        RunContext(origin=RunOrigin.WEB)
        if case == "not_a_channel_turn"
        else _CHANNEL_TURN
    )
    with _channel_request(binding, creator=creator, run_agent_id=run_agent_id):
        assert (
            await w.evaluate(binding, drive, action=action, context=context) == DENIED
        )


# -- the home rule ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "agent, drive, refused",
    [
        (None, "shared", False),
        ("shared", "shared", False),
        ("shared", "private_alice", False),
        ("private_alice", "private_alice", False),
        ("private_alice", "shared", True),
        ("private_alice", "private_bob", True),
    ],
)
def test_check_home_drive(agent, drive, refused):
    alice, bob = uuid4(), uuid4()
    policies = {
        None: None,
        "shared": _shared(),
        "private_alice": _private(alice),
        "private_bob": _private(bob),
    }
    reason = SharingService.check_home_drive(policies[agent], policies[drive])
    assert reason == (HOME_DRIVE_NOT_ALLOWED if refused else None)


# -- the pure rules -----------------------------------------------------------------------


def test_agent_drive_slug_is_one_segment_and_avoids_taken_slugs():
    assert agent_drive_slug("quote", ()) == "quote-files"
    assert agent_drive_slug("Quote Agent!", ()) == "quote-agent-files"
    assert agent_drive_slug("", ()) == "agent-files"
    assert agent_drive_slug("__ag__x", ()) == "ag-x-files"
    assert agent_drive_slug("quote", {"quote-files"}) == "quote-files-2"
    assert (
        agent_drive_slug("quote", {"quote-files", "quote-files-2"}) == "quote-files-3"
    )


def test_the_fill_keeps_a_configuration_with_drives():
    config = {"drives": [], "home_drive": None}
    assert fill_agent_drive_keys(config, "x", _shared(), None) is config


def test_the_fill_lists_the_own_drive_when_the_home_rule_allows():
    alice = uuid4()
    filled = fill_agent_drive_keys({}, "quote-files", _private(alice), _private(alice))
    assert filled == {
        "has_session_drive": True,
        "drives": [{"slug": "quote-files"}],
        "home_drive": "quote-files",
    }
    shared = fill_agent_drive_keys({"has_session_drive": False}, "q", _shared(), None)
    assert shared["drives"] == [{"slug": "q"}]
    assert shared["has_session_drive"] is False


def test_the_fill_gives_a_shared_agent_no_private_own_drive():
    alice = uuid4()
    for agent_policy in (None, _shared(alice)):
        filled = fill_agent_drive_keys({}, "q", _private(alice), agent_policy)
        assert filled["drives"] == []
        assert filled["home_drive"] is None


def test_the_fill_reads_drives_null_as_absent():
    filled = fill_agent_drive_keys({"drives": None}, "q", _shared(), None)
    assert filled["drives"] == [{"slug": "q"}]
    assert filled["home_drive"] == "q"


def test_the_fill_gives_no_drive_when_the_home_rule_refuses():
    alice = uuid4()
    filled = fill_agent_drive_keys({}, "quote-files", _shared(), _private(alice))
    assert filled["drives"] == []
    assert filled["home_drive"] is None
    assert fill_agent_drive_keys({}, None, None, None)["drives"] == []


# -- the visibility change ----------------------------------------------------------------


async def _change(w, artifact_id, visibility, drives=(), homes=()):
    access = RequestAccess(
        principal=_human(w.alice),
        authority=RunAuthority(
            principal=_human(w.alice),
            organization_id=uuid4(),
            project_id=w.project_id,
        ),
        credential_kind=RequestCredentialKind.BEARER_SESSION,
        acting_user_id=w.alice,
    )
    return await w.service.set_agent_visibility(
        organization_id=uuid4(),
        project_id=w.project_id,
        access=access,
        artifact_id=artifact_id,
        visibility=visibility,
        drives=drives,
        home_drives=homes,
    )


async def test_sharing_an_agent_shares_the_owners_private_drives(w):
    agent = w.agent(_private(w.alice))
    own = w.drive(_private(w.alice), slug="notes")
    shared = w.drive(_shared(), slug="prices")
    legacy = w.drive(None, slug="__ag__agent__x__default", agent_id=agent)
    state = await _change(w, agent, Visibility.PROJECT, drives=[own, shared, legacy])
    assert state.drives_made_shared == ["notes"]
    assert w.dao.mounts[(w.project_id, own.mount_id)].policy.visibility == (
        Visibility.PROJECT
    )
    assert w.dao.agents[(w.project_id, agent)].visibility == Visibility.PROJECT


async def test_sharing_refuses_a_private_drive_of_another_owner(w):
    agent = w.agent(_private(w.alice))
    theirs = w.drive(_private(w.bob), slug="bobs-notes")
    with pytest.raises(DriveNotOwned) as caught:
        await _change(w, agent, Visibility.PROJECT, drives=[theirs])
    assert caught.value.details == {"slug": "bobs-notes"}
    assert w.dao.agents[(w.project_id, agent)].visibility == Visibility.PRIVATE


async def test_making_private_refuses_a_shared_home(w):
    agent = w.agent(_shared(w.alice))
    home = w.drive(_shared(), slug="team-notes")
    with pytest.raises(HomeDriveNotAllowed):
        await _change(w, agent, Visibility.PRIVATE, drives=[home], homes=[home])
    assert w.dao.agents[(w.project_id, agent)].visibility == Visibility.PROJECT


async def test_making_private_keeps_a_legacy_own_home(w):
    agent = w.agent(_shared(w.alice))
    own = w.drive(None, agent_id=agent)
    state = await _change(w, agent, Visibility.PRIVATE, drives=[own], homes=[own])
    assert state.policy.visibility == Visibility.PRIVATE
    assert state.drives_made_shared == []


async def test_a_row_written_during_the_change_is_read_under_the_lock(w):
    """The release 2 migration writes the own drive's row (a copy of the shared agent)
    between the decision and the write: the change to private decides again on that
    row and refuses, instead of leaving a private agent with a shared own home."""
    agent = w.agent(_shared(w.alice))
    own = w.drive(None, agent_id=agent)
    key = (w.project_id, own.mount_id)

    def migrate():
        w.dao.mounts[key] = w.dao.mounts[key].model_copy(
            update={"policy": _shared(w.alice)}
        )

    w.dao.before_agent_write = migrate
    with pytest.raises(HomeDriveNotAllowed):
        await _change(w, agent, Visibility.PRIVATE, drives=[own], homes=[own])
    assert w.dao.agents[(w.project_id, agent)].visibility == Visibility.PROJECT


async def test_sharing_writes_a_row_for_another_agents_legacy_drive(w):
    """Agent B lists the drive of the owner's other private agent A, which has no
    visibility row yet: sharing B gives that drive a shared row, owned by the owner."""
    a = w.agent(_private(w.alice))
    b = w.agent(_private(w.alice))
    legacy = w.drive(None, slug="__ag__agent__a__default", agent_id=a)
    state = await _change(w, b, Visibility.PROJECT, drives=[legacy])
    assert state.drives_made_shared == ["__ag__agent__a__default"]
    assert w.dao.mounts[(w.project_id, legacy.mount_id)].policy == AccessPolicy(
        visibility=Visibility.PROJECT, owner_user_id=w.alice
    )
