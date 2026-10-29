"""The ownership rule (`SharingService.initial_policy`, CONTRACT section 7)."""

from uuid import uuid4

import pytest

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, RunOrigin
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    SharedItemKind,
    Visibility,
)
from oss.src.core.sharing.service import SharingService
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO
from oss.tests.pytest.utils.sharing import InMemorySharingDAO


ALICE = uuid4()


def _service() -> SharingService:
    return SharingService(
        sharing_dao=InMemorySharingDAO(),
        memberships_service=MembershipsService(
            memberships_dao=InMemoryMembershipsDAO(),
            policy=MembershipPolicy.PROJECT_ROWS,
        ),
    )


def _human(user_id=ALICE) -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


def _api_key() -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())


def _installation() -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.INSTALLATION, id=uuid4())


def _policy(
    principal, origin, sender_user_id=None, kind=SharedItemKind.SESSION, requested=None
):
    return _service().initial_policy(
        principal=principal,
        origin=origin,
        sender_user_id=sender_user_id,
        kind=kind,
        requested=requested,
    )


@pytest.mark.parametrize("origin", [RunOrigin.WEB, RunOrigin.API])
@pytest.mark.parametrize("principal", [_human(uuid4()), _api_key()])
def test_turn_sender_owns(origin, principal):
    assert _policy(principal, origin, sender_user_id=ALICE) == AccessPolicy(
        visibility=Visibility.PRIVATE, owner_user_id=ALICE
    )


def test_web_human_owns():
    assert _policy(_human(), RunOrigin.WEB) == AccessPolicy(
        visibility=Visibility.PRIVATE, owner_user_id=ALICE
    )


def test_schedule_human_owns():
    assert _policy(_human(), RunOrigin.SCHEDULE) == AccessPolicy(
        visibility=Visibility.PRIVATE, owner_user_id=ALICE
    )


def test_api_key_never_owns():
    assert (
        _policy(_api_key(), RunOrigin.API, requested=Visibility.PRIVATE)
        == OWNERLESS_PROJECT_POLICY
    )


def test_installation_never_owns():
    assert (
        _policy(_installation(), RunOrigin.INSTALLATION, sender_user_id=ALICE)
        == OWNERLESS_PROJECT_POLICY
    )
    # The origin decides, not the principal kind.
    assert (
        _policy(_human(), RunOrigin.INSTALLATION, sender_user_id=ALICE)
        == OWNERLESS_PROJECT_POLICY
    )


def test_subscription_never_owns():
    assert _policy(_human(), RunOrigin.SUBSCRIPTION) == OWNERLESS_PROJECT_POLICY


def test_child_never_owns():
    assert (
        _policy(_human(), RunOrigin.CHILD, sender_user_id=ALICE)
        == OWNERLESS_PROJECT_POLICY
    )


def test_evaluation_never_owns():
    assert _policy(_human(), RunOrigin.EVALUATION) == OWNERLESS_PROJECT_POLICY


def test_api_key_on_schedule_never_owns():
    assert _policy(_api_key(), RunOrigin.SCHEDULE) == OWNERLESS_PROJECT_POLICY


def test_channel_session_ownerless_with_linked_sender():
    assert (
        _policy(
            _human(),
            RunOrigin.WEB,
            sender_user_id=ALICE,
            kind=SharedItemKind.CHANNEL_SESSION,
            requested=Visibility.PRIVATE,
        )
        == OWNERLESS_PROJECT_POLICY
    )


def test_agent_kind_follows_the_same_rule():
    assert _policy(_human(), RunOrigin.WEB, kind=SharedItemKind.AGENT) == AccessPolicy(
        visibility=Visibility.PRIVATE, owner_user_id=ALICE
    )
    assert (
        _policy(_api_key(), RunOrigin.API, kind=SharedItemKind.AGENT)
        == OWNERLESS_PROJECT_POLICY
    )


def test_omitted_visibility_owner_default():
    assert _policy(_human(), RunOrigin.WEB, requested=None).visibility == (
        Visibility.PRIVATE
    )


def test_requested_project_keeps_owner():
    assert _policy(_human(), RunOrigin.WEB, requested=Visibility.PROJECT) == (
        AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=ALICE)
    )


def test_private_request_dropped_without_owner():
    # No exception: the requested private is dropped.
    assert (
        _policy(_api_key(), RunOrigin.API, requested=Visibility.PRIVATE)
        == OWNERLESS_PROJECT_POLICY
    )


def test_private_policy_requires_owner():
    with pytest.raises(ValueError, match="A private item needs an owner."):
        AccessPolicy(visibility=Visibility.PRIVATE)
