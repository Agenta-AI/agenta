"""`check_project_has_role_or_permission` resolves one membership row.

It read the project's whole member list and scanned it in Python. These tests
pin both halves of the change: the one-row lookup it now makes, and the verdicts
it reaches from that row, which must match the list-scanning behavior exactly.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.access.permissions import service as permissions_service
from oss.src.core.access.permissions.service import (
    check_project_has_role_or_permission,
)
from oss.src.core.access.permissions.types import Permission, RequiredRole
from oss.src.services import db_manager


ORGANIZATION_ID = uuid4()
PROJECT_ID = uuid4()
OWNER_ID = uuid4()
USER_ID = uuid4()


def _project():
    return SimpleNamespace(id=PROJECT_ID, organization_id=ORGANIZATION_ID)


def _member(role, *, is_demo=None, user_id=USER_ID):
    return SimpleNamespace(user_id=user_id, role=role, is_demo=is_demo)


@pytest.fixture
def lookups(monkeypatch):
    """Record the membership lookup and stub the organization read.

    `calls` holds the (project_id, user_id) pairs the check asked for, so a test
    can assert the lookup is scoped and not a whole-project read.
    """

    calls = []
    state = SimpleNamespace(member=None, owner_id=OWNER_ID, calls=calls)

    async def _get_project_member(project_id, user_id):
        calls.append((project_id, user_id))
        return state.member

    async def _get_organization(organization_id):
        return SimpleNamespace(id=organization_id, owner_id=state.owner_id)

    async def _refuse_get_project_members(project_id):
        raise AssertionError(
            "the access check must not read the project's whole member list"
        )

    monkeypatch.setattr(db_manager, "get_project_member", _get_project_member)
    monkeypatch.setattr(db_manager, "get_organization", _get_organization)
    monkeypatch.setattr(db_manager, "get_project_members", _refuse_get_project_members)

    return state


@pytest.mark.asyncio
async def test_the_check_looks_the_member_up_by_project_and_user(lookups):
    lookups.member = _member(RequiredRole.OWNER.value)

    await check_project_has_role_or_permission(
        _project(), str(USER_ID), role=RequiredRole.OWNER
    )

    assert lookups.calls == [(str(PROJECT_ID), str(USER_ID))]


@pytest.mark.asyncio
async def test_the_organization_owner_passes_without_a_membership_row(lookups):
    lookups.member = None
    lookups.owner_id = USER_ID

    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), permission=Permission.VIEW_APPLICATIONS
        )
        is True
    )


@pytest.mark.asyncio
async def test_a_project_owner_passes_any_role_or_permission(lookups):
    lookups.member = _member(RequiredRole.OWNER.value)

    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), role=RequiredRole.VIEWER
        )
        is True
    )
    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), permission=Permission.EDIT_APPLICATIONS
        )
        is True
    )


@pytest.mark.asyncio
async def test_a_role_check_matches_the_members_own_role_exactly(lookups):
    lookups.member = _member(RequiredRole.ADMIN.value)

    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), role=RequiredRole.ADMIN
        )
        is True
    )
    # Exact match, not implication: an admin does not satisfy a viewer check.
    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), role=RequiredRole.VIEWER
        )
        is False
    )


@pytest.mark.asyncio
async def test_a_role_check_accepts_a_role_slug_string(lookups):
    lookups.member = _member("editor")

    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), role="editor"
        )
        is True
    )


@pytest.mark.asyncio
async def test_a_permission_check_reads_the_roles_permission_set(lookups):
    lookups.member = _member(RequiredRole.VIEWER.value)

    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), permission=Permission.VIEW_APPLICATIONS
        )
        is True
    )
    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), permission=Permission.EDIT_APPLICATIONS
        )
        is False
    )


@pytest.mark.asyncio
async def test_a_non_member_is_refused(lookups):
    lookups.member = None

    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), permission=Permission.VIEW_APPLICATIONS
        )
        is False
    )
    assert (
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), role=RequiredRole.VIEWER
        )
        is False
    )


@pytest.mark.asyncio
async def test_an_unknown_role_is_still_rejected(lookups):
    lookups.member = _member(RequiredRole.VIEWER.value)

    with pytest.raises(Exception, match="Invalid role specified"):
        await check_project_has_role_or_permission(
            _project(), str(USER_ID), role="not-a-role"
        )


@pytest.mark.asyncio
async def test_either_a_role_or_a_permission_is_still_required(lookups):
    lookups.member = _member(RequiredRole.VIEWER.value)

    with pytest.raises(AssertionError, match="Either role or permission"):
        await check_project_has_role_or_permission(_project(), str(USER_ID))


def test_the_demo_flag_is_read_off_the_one_member_row():
    # The EE entitlement bypass is skipped for a demo member, so this flag
    # decides whether a non-RBAC plan grants allow-all. It used to be found by
    # scanning the member list.
    assert permissions_service._is_demo_member(_member("viewer", is_demo=True)) is True
    assert (
        permissions_service._is_demo_member(_member("viewer", is_demo=False)) is False
    )
    assert permissions_service._is_demo_member(None) is False


def test_a_member_row_without_the_demo_column_is_not_a_demo_member():
    assert permissions_service._is_demo_member(SimpleNamespace(role="viewer")) is False
