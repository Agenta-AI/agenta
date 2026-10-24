"""`AccessService.check_capability`: one membership read, then the role catalog.

Order (CONTRACT section 6, steps 1 and 3): membership eligibility first, so the EE
no-RBAC shortcut, the organization-owner shortcut and the project `owner` role apply
only to members. A member with no role (an EE project row with a null role) passes the
two shortcuts and is denied every role and permission check (fail closed).
"""

from typing import Optional
from uuid import UUID

from oss.src.core.access.controls import get_role, get_role_permissions
from oss.src.core.access.dtos import Action, Decision, DecisionReason, RoleRequirement
from oss.src.core.access.interfaces import RbacEnforcementInterface
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.types import (
    AccessServiceNotRegistered,
    InvalidPermission,
    InvalidRoleRequirement,
)
from oss.src.core.memberships.service import MembershipsService
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

_SCOPE = "project"
_OWNER_ROLE = "owner"


def _action_name(action: Action) -> str:
    if isinstance(action, RoleRequirement):
        return f"role:{action.role}"
    return f"permission:{getattr(action, 'value', action)}"


class AccessService:
    def __init__(
        self,
        *,
        memberships: MembershipsService,
        rbac: RbacEnforcementInterface,
    ):
        self._memberships = memberships
        self._rbac = rbac

    @property
    def rbac(self) -> RbacEnforcementInterface:
        return self._rbac

    @property
    def memberships(self) -> MembershipsService:
        return self._memberships

    def _deny(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        action: Action,
        reason: DecisionReason,
    ) -> Decision:
        log.debug(
            "[access] denied",
            user_id=str(user_id),
            project_id=str(project_id),
            action=_action_name(action),
            reason=reason.value,
        )
        return Decision(allowed=False, reason=reason)

    async def check_capability(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        action: Action,
    ) -> Decision:
        # 1. Membership eligibility, before every shortcut.
        membership = await self._memberships.resolve(
            user_id=user_id,
            project_id=project_id,
        )
        if membership is None:
            return self._deny(
                user_id=user_id,
                project_id=project_id,
                action=action,
                reason=DecisionReason.NOT_MEMBER,
            )

        # 2. EE organizations without the RBAC entitlement: every member passes.
        if not await self._rbac.is_enforced(organization_id=membership.organization_id):
            return Decision(allowed=True, reason=DecisionReason.RBAC_NOT_ENTITLED)

        # 3. The organization owner passes, as a member.
        if membership.is_organization_owner:
            return Decision(allowed=True, reason=DecisionReason.ORGANIZATION_OWNER)

        role: Optional[str] = membership.role

        # 4. The project owner role passes any check.
        if role == _OWNER_ROLE:
            return Decision(allowed=True, reason=DecisionReason.PROJECT_OWNER)

        # 5. A role requirement matches the member's role exactly.
        if isinstance(action, RoleRequirement):
            if get_role(_SCOPE, action.role) is None:
                raise InvalidRoleRequirement()
            if role is not None and role == action.role:
                return Decision(allowed=True, reason=DecisionReason.ROLE)
            return self._deny(
                user_id=user_id,
                project_id=project_id,
                action=action,
                reason=DecisionReason.MISSING_CAPABILITY,
            )

        # 6. A permission comes from the role's catalog entry.
        if not isinstance(action, Permission) or action not in list(Permission):
            raise InvalidPermission()

        if role is not None:
            if get_role(_SCOPE, role) is None:
                # An organization role slug the project catalog does not define
                # gives no permissions.
                log.warning(
                    "[access] undefined role slug",
                    role=role,
                    project_id=str(project_id),
                )
            else:
                permissions = get_role_permissions(_SCOPE, role)
                if "*" in permissions or action.value in permissions:
                    return Decision(allowed=True, reason=DecisionReason.ROLE)

        return self._deny(
            user_id=user_id,
            project_id=project_id,
            action=action,
            reason=DecisionReason.MISSING_CAPABILITY,
        )


_access_service: Optional[AccessService] = None


def register_access_service(*, access_service: AccessService) -> None:
    global _access_service
    _access_service = access_service


def get_access_service() -> AccessService:
    if _access_service is None:
        raise AccessServiceNotRegistered(
            "AccessService is not registered. "
            "Call entrypoints.access.bootstrap_access() at process startup."
        )
    return _access_service
