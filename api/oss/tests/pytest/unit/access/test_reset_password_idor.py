"""Regression tests for the password-reset IDOR fix.

The vulnerability: ``POST /profile/reset-password?user_id=<target>`` verified the
*caller's* ``RESET_PASSWORD`` permission but never checked whether the *target*
``user_id`` belonged to the caller's organization. An admin in Org A could generate
a reset link for any user in Org B.

These tests mock the DB and service layers and call the router handler directly,
following the existing unit-test pattern (e.g. test_edit_endpoint_name_validation).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

# ---------------------------------------------------------------------------
# Stable IDs used across tests
# ---------------------------------------------------------------------------

ORG_A_ID = str(uuid4())
ORG_B_ID = str(uuid4())

CALLER_USER_ID = str(uuid4())  # admin in Org A
TARGET_SAME_ORG_USER_ID = str(uuid4())  # user in Org A
TARGET_OTHER_ORG_USER_ID = str(uuid4())  # user in Org B (not in Org A)
TARGET_NONEXISTENT_USER_ID = str(uuid4())  # does not exist

PROJECT_ID = str(uuid4())  # belongs to Org A


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_request(*, user_id=CALLER_USER_ID, project_id=PROJECT_ID):
    return SimpleNamespace(
        state=SimpleNamespace(
            user_id=user_id,
            project_id=project_id,
        )
    )


def _make_project(*, organization_id=ORG_A_ID):
    return SimpleNamespace(
        id=uuid4(),
        organization_id=organization_id,
        workspace_id=uuid4(),
    )


def _make_user(*, user_id, email="user@test.agenta.ai", username="testuser"):
    return SimpleNamespace(
        id=user_id,
        uid=str(uuid4()),
        email=email,
        username=username,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def _allow_access():
    """Patch check_action_access to always allow (caller has RESET_PASSWORD)."""
    with patch(
        "oss.src.routers.user_profile.check_action_access",
        AsyncMock(return_value=True),
    ):
        yield


@pytest.fixture
def _deny_access():
    """Patch check_action_access to deny (caller lacks RESET_PASSWORD)."""
    with patch(
        "oss.src.routers.user_profile.check_action_access",
        AsyncMock(return_value=False),
    ):
        yield


# ---------------------------------------------------------------------------
# Test 1 — Cross-organization reset is rejected
# ---------------------------------------------------------------------------


class TestCrossOrgResetBlocked:
    """An admin in Org A must NOT be able to reset a user in Org B."""

    @pytest.mark.asyncio
    async def test_cross_org_reset_returns_403(self, _allow_access):
        from oss.src.routers.user_profile import reset_user_password

        project = _make_project(organization_id=ORG_A_ID)

        # Target user is ONLY in Org B
        target_org_data = {
            "id": TARGET_OTHER_ORG_USER_ID,
            "uid": str(uuid4()),
            "organization_ids": [ORG_B_ID],
            "workspace_ids": [str(uuid4())],
        }

        with (
            patch(
                "oss.src.routers.user_profile.db_manager.get_project_by_id",
                AsyncMock(return_value=project),
            ),
            patch(
                "oss.src.routers.user_profile.db_manager.get_organization_owner",
                AsyncMock(return_value=None),
            ),
            patch(
                "oss.src.services.user_service.db_manager.get_user_org_and_workspace_id",
                AsyncMock(return_value=target_org_data),
            ),
            patch(
                "oss.src.services.user_service.create_reset_password_link",
                AsyncMock(side_effect=AssertionError("Should not create reset link")),
            ),
        ):
            response = await reset_user_password(
                request=_make_request(),
                user_id=TARGET_OTHER_ORG_USER_ID,
            )

        assert response.status_code == 403
        assert "permission" in response.body.decode().lower()


# ---------------------------------------------------------------------------
# Test 2 — Same-organization reset succeeds
# ---------------------------------------------------------------------------


class TestSameOrgResetAllowed:
    """An admin in Org A CAN reset a user who is also in Org A."""

    @pytest.mark.asyncio
    async def test_same_org_reset_succeeds(self, _allow_access):
        from oss.src.routers.user_profile import reset_user_password

        project = _make_project(organization_id=ORG_A_ID)

        # Target user IS in Org A
        target_org_data = {
            "id": TARGET_SAME_ORG_USER_ID,
            "uid": str(uuid4()),
            "organization_ids": [ORG_A_ID],
            "workspace_ids": [str(uuid4())],
        }

        target_user = _make_user(
            user_id=TARGET_SAME_ORG_USER_ID, email="target@test.agenta.ai"
        )
        admin_user = _make_user(
            user_id=CALLER_USER_ID,
            email="admin@test.agenta.ai",
            username="admin",
        )

        fake_reset_link = "https://app.agenta.ai/reset?token=fake123"

        with (
            patch(
                "oss.src.routers.user_profile.db_manager.get_project_by_id",
                AsyncMock(return_value=project),
            ),
            patch(
                "oss.src.routers.user_profile.db_manager.get_organization_owner",
                AsyncMock(return_value=None),
            ),
            patch(
                "oss.src.services.user_service.db_manager.get_user_org_and_workspace_id",
                AsyncMock(return_value=target_org_data),
            ),
            patch(
                "oss.src.services.db_manager.get_user_with_id",
                AsyncMock(
                    side_effect=lambda user_id: {
                        TARGET_SAME_ORG_USER_ID: target_user,
                        CALLER_USER_ID: admin_user,
                    }[user_id]
                ),
            ),
            patch(
                "oss.src.services.user_service.create_reset_password_link",
                AsyncMock(return_value=fake_reset_link),
            ),
            patch(
                "oss.src.services.user_service.env",
                SimpleNamespace(
                    smtp=SimpleNamespace(enabled=False),
                    sendgrid=SimpleNamespace(enabled=False),
                ),
            ),
        ):
            response = await reset_user_password(
                request=_make_request(),
                user_id=TARGET_SAME_ORG_USER_ID,
            )

        # When SMTP is disabled, the link is returned directly
        assert response == fake_reset_link


# ---------------------------------------------------------------------------
# Test 3 — Nonexistent target user returns 404
# ---------------------------------------------------------------------------


class TestNonexistentTargetUser:
    """Requesting a reset for a user_id that does not exist should return 404."""

    @pytest.mark.asyncio
    async def test_nonexistent_user_returns_404(self, _allow_access):
        from sqlalchemy.exc import NoResultFound

        from oss.src.routers.user_profile import reset_user_password

        project = _make_project(organization_id=ORG_A_ID)

        with (
            patch(
                "oss.src.routers.user_profile.db_manager.get_project_by_id",
                AsyncMock(return_value=project),
            ),
            patch(
                "oss.src.routers.user_profile.db_manager.get_organization_owner",
                AsyncMock(return_value=None),
            ),
            patch(
                "oss.src.services.db_manager.get_user_org_and_workspace_id",
                AsyncMock(
                    side_effect=NoResultFound(
                        f"User with uid {TARGET_NONEXISTENT_USER_ID} not found"
                    )
                ),
            ),
        ):
            response = await reset_user_password(
                request=_make_request(),
                user_id=TARGET_NONEXISTENT_USER_ID,
            )

        assert response.status_code == 404
        # Must NOT leak whether the user exists in another org
        body = response.body.decode()
        assert TARGET_NONEXISTENT_USER_ID not in body


# ---------------------------------------------------------------------------
# Test 4 — Caller without RESET_PASSWORD permission is rejected
# ---------------------------------------------------------------------------


class TestCallerLacksPermission:
    """A user without RESET_PASSWORD gets 403 even for a same-org target."""

    @pytest.mark.asyncio
    async def test_no_permission_returns_403(self, _deny_access):
        from oss.src.routers.user_profile import reset_user_password

        response = await reset_user_password(
            request=_make_request(),
            user_id=TARGET_SAME_ORG_USER_ID,
        )

        assert response.status_code == 403
        assert "access" in response.body.decode().lower()
