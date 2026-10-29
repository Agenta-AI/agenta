"""The organization access decision (M5, CONTRACT section 6).

Organization-scoped actions (today: managing organization credentials) are decided here
and nowhere else. The rule is the same in OSS and EE, and it reads no entitlement, project
row, project role or custom role, so the EE no-RBAC bypass and the organization-owner
shortcut of project RBAC never apply.

1. A browser-session human acting as itself, with no run envelope. Every API key (an M6
   personal key included, whose principal is a human), every run credential, an admin
   `Access` request (no request access) and an unknown credential are refused.
   A Bearer request carries an authority built from the session (M2), so the run marker
   is the envelope, not the authority.
2. The human has an `organization_members` row in the organization (read uncached, one
   statement, so a role change applies to the next request).
3. The row's role is `owner` or `admin`.

No result is cached.
"""

from enum import Enum
from typing import Optional
from uuid import UUID

from oss.src.core.access.dtos import (
    Decision,
    DecisionReason,
    PrincipalKind,
    RequestAccess,
    RequestCredentialKind,
)
from oss.src.core.memberships.service import get_memberships_service
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_MANAGING_ROLES = frozenset({"owner", "admin"})


class OrganizationAction(str, Enum):
    MANAGE_ORGANIZATION_SECRETS = "manage_organization_secrets"


def _denied(
    *,
    access: Optional[RequestAccess],
    organization_id: UUID,
    action: OrganizationAction,
    reason: DecisionReason,
) -> Decision:
    log.info(
        "[access] organization decision denied",
        principal_kind=access.principal.kind.value if access else None,
        principal_id=str(access.principal.id) if access else None,
        organization_id=str(organization_id),
        action=action.value,
        reason=reason.value,
    )
    return Decision(allowed=False, reason=reason)


async def decide_organization(
    *,
    access: Optional[RequestAccess],
    organization_id: UUID,
    action: OrganizationAction,
) -> Decision:
    if (
        access is None
        or access.credential_kind != RequestCredentialKind.BEARER_SESSION
        or access.envelope is not None
        or access.principal.kind != PrincipalKind.HUMAN
        or access.principal.id != access.acting_user_id
    ):
        return _denied(
            access=access,
            organization_id=organization_id,
            action=action,
            reason=DecisionReason.MISSING_CAPABILITY,
        )

    member = await get_memberships_service().fetch_organization_member(
        organization_id=organization_id,
        user_id=access.principal.id,
    )
    if member is None:
        return _denied(
            access=access,
            organization_id=organization_id,
            action=action,
            reason=DecisionReason.NOT_MEMBER,
        )

    if member.role not in _MANAGING_ROLES:
        return _denied(
            access=access,
            organization_id=organization_id,
            action=action,
            reason=DecisionReason.MISSING_CAPABILITY,
        )

    return Decision(allowed=True, reason=DecisionReason.ROLE)
