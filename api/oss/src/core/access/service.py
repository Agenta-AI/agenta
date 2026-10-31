"""`AccessService`: the one access decision point.

`decide` runs on every call; no cache stores a decision. Order (CONTRACT section 6), the
first denial wins:

1. Eligibility: the principal record is active and not expired, it belongs to the
   requested project, and its role user is a member there (`principal_inactive`,
   `not_member`).
2. Restrictions, when an authority is given: the authority names the same principal and
   project, and carries no agent restriction (unsupported in M2)
   (`restricted_by_authority`).
3. Capability: the organization owner, the project owner role, then the role catalog
   (`missing_capability`). It applies on every edition and plan.
4. Resource policy, only when a resource is given and steps 1 to 3 allowed: the
   `ResourcePolicyInterface` (M3 sharing; `resource_denied`). It runs after every step 3
   shortcut, so no shortcut opens a private item.

The tenant comes only from the requested project and the principal record. On warm
caches a decision reads two Redis entries (`fetch_principal`, `resolve_membership`) and
no Postgres row. A member with no role (an EE project row with a null role) passes the
owner checks and is denied every role and permission check (fail closed).
"""

from datetime import datetime, timezone
from typing import Optional, Sequence
from uuid import UUID

from oss.src.core.access import prefetch
from oss.src.core.access.context import get_request_access, get_request_memo
from oss.src.core.access.controls import get_role, get_role_permissions, get_roles
from oss.src.core.access.dtos import (
    Action,
    Decision,
    DecisionReason,
    OfferedRoles,
    PrincipalKind,
    PrincipalRef,
    RequestAccess,
    RequestCredentialKind,
    ResourceRef,
    RoleRequirement,
    RunAuthority,
    RunContext,
    RunEnvelope,
    ScopePrincipals,
    UserPrincipals,
)
from oss.src.core.access.interfaces import (
    PrincipalsDAOInterface,
    RbacEntitlementInterface,
    ResourcePolicyInterface,
)
from oss.src.core.access.permissions.types import DefaultRole, Permission
from oss.src.core.access.types import (
    AccessDenied,
    AccessServiceNotRegistered,
    DecisionInputMissing,
    InvalidPermission,
    InvalidRoleRequirement,
    RoleNotOffered,
)
from oss.src.core.memberships.dtos import ProjectMembership
from oss.src.core.memberships.service import MembershipsService
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

# The catalog scope of every member role: the access check reads it, and the invite and
# role routes validate and offer from it.
ROLE_SCOPE = "project"
_MISSING = object()
_OWNER_ROLE = "owner"


def _action_name(action: Action) -> str:
    if isinstance(action, RoleRequirement):
        return f"role:{action.role}"
    return f"permission:{getattr(action, 'value', action)}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AccessService:
    def __init__(
        self,
        *,
        memberships: MembershipsService,
        rbac_entitlement: RbacEntitlementInterface,
        principals: PrincipalsDAOInterface,
        resource_policy: ResourcePolicyInterface,
    ):
        self._memberships = memberships
        self._rbac_entitlement = rbac_entitlement
        self._principals = principals
        self._resource_policy = resource_policy

    @property
    def rbac_entitlement(self) -> RbacEntitlementInterface:
        return self._rbac_entitlement

    @property
    def memberships(self) -> MembershipsService:
        return self._memberships

    @property
    def principals(self) -> PrincipalsDAOInterface:
        return self._principals

    @property
    def resource_policy(self) -> ResourcePolicyInterface:
        return self._resource_policy

    # -- the decision -----------------------------------------------------------------

    async def decide(
        self,
        *,
        authority: Optional[RunAuthority],
        principal: PrincipalRef,
        action: Action,
        #
        project_id: Optional[UUID] = None,
        resource: Optional[ResourceRef] = None,
        context: Optional[RunContext] = None,
    ) -> Decision:
        """`context`: the run context of a server-signed run envelope (a run credential,
        or durable work), never of a client field. The resource rules read its origin."""
        return await self._decide(
            authority=authority,
            principal=principal,
            action=action,
            project_id=project_id,
            resource=resource,
            context=context,
        )

    async def _decide(
        self,
        *,
        authority: Optional[RunAuthority],
        principal: PrincipalRef,
        action: Action,
        project_id: Optional[UUID],
        resource: Optional[ResourceRef],
        context: Optional[RunContext],
    ) -> Decision:
        project = project_id or (authority.project_id if authority else None)
        if project is None:
            raise DecisionInputMissing()

        if resource is not None:
            # The resource's sharing entry rides in the decision's one cache read.
            self._resource_policy.prefetch(project_id=project, resource=resource)
        membership, denial, role_user_id = await self._eligibility(
            authority=authority,
            principal=principal,
            project_id=project,
        )
        if denial is not None:
            return self._deny(
                authority=authority,
                principal=principal,
                project_id=project,
                action=action,
                resource=resource,
                reason=denial,
                role_user_id=role_user_id,
                context=context,
            )

        restriction = self._restrictions(
            authority=authority, principal=principal, project_id=project
        )
        if restriction is not None:
            return self._deny(
                authority=authority,
                principal=principal,
                project_id=project,
                action=action,
                resource=resource,
                reason=restriction,
                role_user_id=membership.user_id,
                context=context,
            )

        decision = await self._capability(membership=membership, action=action)
        if not decision.allowed:
            return self._deny(
                authority=authority,
                principal=principal,
                project_id=project,
                action=action,
                resource=resource,
                reason=decision.reason,
                role_user_id=membership.user_id,
                context=context,
            )

        if resource is not None:
            # Step 4, after every step 3 shortcut (organization owner, project owner
            # role): none of them opens a private item.
            denial = await self._resource_policy.evaluate(
                principal=principal,
                action=action,
                project_id=project,
                resource=resource,
                context=context,
            )
            if denial is not None:
                return self._deny_resource(
                    principal=principal,
                    project_id=project,
                    action=action,
                    resource=resource,
                    reason=denial,
                    acting_user_id=membership.user_id,
                    context=context,
                )
        return decision

    async def check_eligibility(
        self,
        *,
        authority: Optional[RunAuthority],
        principal: PrincipalRef,
        project_id: UUID,
    ) -> Decision:
        """`decide` steps 1 and 2 only: for credential exchanges that check no
        permission (`POST /gateways/credentials`)."""

        if project_id is None:
            raise DecisionInputMissing()

        membership, denial, role_user_id = await self._eligibility(
            authority=authority, principal=principal, project_id=project_id
        )
        if denial is None:
            denial = self._restrictions(
                authority=authority, principal=principal, project_id=project_id
            )
        if denial is not None:
            return self._deny(
                authority=authority,
                principal=principal,
                project_id=project_id,
                action=None,
                resource=None,
                reason=denial,
                role_user_id=role_user_id,
                context=None,
            )
        return Decision(allowed=True, reason=DecisionReason.ELIGIBLE)

    async def check_request(
        self,
        *,
        access: RequestAccess,
        action: Action,
        project_id: UUID,
        #
        resource: Optional[ResourceRef] = None,
    ) -> Decision:
        """The decision for the current request's principal. A browser session passes
        no authority, so its user can check another of their projects; an API key and a
        run credential pass theirs, so they stay in their project."""

        if project_id is None:
            raise DecisionInputMissing()

        authority = (
            None
            if access.credential_kind == RequestCredentialKind.BEARER_SESSION
            else access.authority
        )
        # Only a run credential carries a run context: it is signed by the server.
        context = (
            access.envelope.context
            if access.credential_kind == RequestCredentialKind.RUN_CREDENTIAL
            and access.envelope is not None
            else None
        )
        return await self.decide(
            authority=authority,
            principal=access.principal,
            action=action,
            project_id=project_id,
            resource=resource,
            context=context,
        )

    async def check_human(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        action: Action,
    ) -> Decision:
        """An explicit check about a named human, not a run (for example the MCP OAuth
        callback, which runs without the auth middleware)."""

        return await self.decide(
            authority=None,
            principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id),
            action=action,
            project_id=project_id,
        )

    async def require(
        self,
        *,
        envelope: RunEnvelope,
        action: Action,
        #
        resource: Optional[ResourceRef] = None,
    ) -> None:
        """Raise `AccessDenied` unless the envelope's principal may do `action` in the
        envelope's project. Durable work calls it before it runs."""

        decision = await self._decide(
            authority=envelope.authority,
            principal=envelope.authority.principal,
            action=action,
            project_id=None,
            resource=resource,
            context=envelope.context,
        )
        if not decision.allowed:
            raise AccessDenied(decision=decision)

    async def project_organization_id(self, *, project_id: UUID) -> Optional[UUID]:
        """The organization of a project, for envelopes of durable work (triggers,
        evaluations, channel turns), which run outside a request."""

        return await self._principals.fetch_project_organization_id(
            project_id=project_id
        )

    async def read_user_principals(self, *, user_id: UUID) -> UserPrincipals:
        """Read before a user deletion: what `invalidate_user` must clear after it."""

        return await self._principals.list_user_principals(user_id=user_id)

    async def invalidate_user(
        self,
        *,
        snapshot: UserPrincipals,
        memberships: bool = True,
    ) -> None:
        """After a user deletion committed: the user, their keys, their bindings, and
        (unless the caller cleared them already) their cached memberships."""

        await self.invalidate_principals(
            principals=[
                PrincipalRef(kind=PrincipalKind.HUMAN, id=snapshot.user_id),
                *(
                    PrincipalRef(kind=PrincipalKind.API_KEY, id=key_id)
                    for key_id in snapshot.api_key_ids
                ),
                *(
                    PrincipalRef(kind=PrincipalKind.INSTALLATION, id=binding_id)
                    for binding_id in snapshot.binding_ids
                ),
            ]
        )
        if memberships and snapshot.project_ids:
            from oss.src.core.memberships.service import (  # noqa: PLC0415
                invalidate_access_caches,
            )

            await invalidate_access_caches(
                user_ids=[snapshot.user_id], project_ids=snapshot.project_ids
            )

    async def invalidate_principals(self, *, principals) -> None:
        for principal in principals:
            await self.invalidate_principal(principal=principal)

    async def read_scope_principals(
        self,
        *,
        organization_ids: Sequence[UUID] = (),
        workspace_ids: Sequence[UUID] = (),
        project_ids: Sequence[UUID] = (),
    ) -> ScopePrincipals:
        """Read before deleting organizations, workspaces or projects."""

        return await self._principals.list_scope_principals(
            organization_ids=organization_ids,
            workspace_ids=workspace_ids,
            project_ids=project_ids,
        )

    async def invalidate_scope(self, *, snapshot: ScopePrincipals) -> None:
        """After the cascade delete committed: the keys and bindings that went, and the
        cached memberships of every user in the deleted projects (one pattern call per
        namespace per project, never one call per member)."""

        await self.invalidate_principals(
            principals=[
                *(
                    PrincipalRef(kind=PrincipalKind.API_KEY, id=key_id)
                    for key_id in snapshot.api_key_ids
                ),
                *(
                    PrincipalRef(kind=PrincipalKind.INSTALLATION, id=binding_id)
                    for binding_id in snapshot.binding_ids
                ),
            ]
        )
        if snapshot.project_ids:
            from oss.src.core.memberships.service import (  # noqa: PLC0415
                invalidate_access_caches,
            )

            await invalidate_access_caches(
                user_ids=[], project_ids=snapshot.project_ids
            )

    async def acting_user_id(self, *, authority: RunAuthority) -> Optional[UUID]:
        """The user a run acts as: its human, its API key's creator, or its
        installation's linked user (else the binding creator). Read from the cached
        principal record, never from a request or command field. `None` when the
        principal is not active."""

        principal = authority.principal
        # The record first, in the order `_eligibility` uses: an inactive or expired
        # principal has no acting user, also an installation with a linked user.
        # The request memo: the invoke's own access decision read this record already.
        memo = get_request_memo()
        if memo is None:
            memo = {}
        record = await self._principal_record(
            authority=authority,
            principal=principal,
            project_id=authority.project_id,
            memo=memo,
        )
        if record is None or not record.is_active:
            return None
        if record.expires_at is not None and record.expires_at <= _now():
            return None
        if principal.kind == PrincipalKind.INSTALLATION and authority.linked_user_id:
            return authority.linked_user_id
        return record.acting_user_id

    async def invalidate_principal(self, *, principal: PrincipalRef) -> None:
        try:
            cleared = await self._principals.invalidate_principal(principal=principal)
        except Exception:  # pylint: disable=broad-exception-caught
            cleared = None
        if cleared is None and env.agenta.api.caching.enabled:
            log.warning(
                "[access] principal invalidation failed",
                principal_kind=principal.kind.value,
                principal_id=str(principal.id),
            )

    # -- steps ------------------------------------------------------------------------

    async def _eligibility(
        self,
        *,
        authority: Optional[RunAuthority],
        principal: PrincipalRef,
        project_id: UUID,
    ) -> tuple[Optional[ProjectMembership], Optional[DecisionReason], Optional[UUID]]:
        """(membership, denial, role user). The role user is also returned on a
        denial, for the audit log."""

        # Within a request: the request memo. Outside one (workers): this decision's
        # own scratch, so the membership read with the record is still used.
        memo = get_request_memo()
        if memo is None:
            memo = {}
        record = await self._principal_record(
            authority=authority, principal=principal, project_id=project_id, memo=memo
        )
        if record is None or not record.is_active:
            return None, DecisionReason.PRINCIPAL_INACTIVE, None
        if record.expires_at is not None and record.expires_at <= _now():
            return None, DecisionReason.PRINCIPAL_INACTIVE, record.acting_user_id
        if record.project_id is not None and record.project_id != project_id:
            return None, DecisionReason.NOT_MEMBER, record.acting_user_id

        role_user_id = record.acting_user_id
        if (
            authority is not None
            and principal.kind == PrincipalKind.INSTALLATION
            and authority.principal == principal
            and authority.linked_user_id is not None
        ):
            role_user_id = authority.linked_user_id
        if role_user_id is None:
            return None, DecisionReason.PRINCIPAL_INACTIVE, None

        membership = await self._membership(
            user_id=role_user_id, project_id=project_id, memo=memo
        )
        if membership is None:
            return None, DecisionReason.NOT_MEMBER, role_user_id
        # A credential names its organization; the project must be in it (a run
        # credential minted for a legacy cross-organization project names another one).
        if (
            authority is not None
            and authority.organization_id != membership.organization_id
        ):
            return None, DecisionReason.NOT_MEMBER, role_user_id
        return membership, None, role_user_id

    # -- reads: one Redis round trip per request on warm caches -------------------------

    @staticmethod
    def _role_user_hint(
        *, authority: Optional[RunAuthority], principal: PrincipalRef
    ) -> Optional[UUID]:
        """The user whose membership this decision will most likely read, known before
        the principal record: a human itself, an installation's linked user, or the
        request's acting user when the request runs as this principal (an API key's
        creator). Only a hint: the record decides, and a wrong hint costs one read."""

        if principal.kind == PrincipalKind.HUMAN:
            return principal.id
        if (
            authority is not None
            and principal.kind == PrincipalKind.INSTALLATION
            and authority.principal == principal
            and authority.linked_user_id is not None
        ):
            return authority.linked_user_id
        access = get_request_access()
        if access is not None and access.principal == principal:
            return access.acting_user_id
        return None

    async def _principal_record(
        self,
        *,
        authority: Optional[RunAuthority],
        principal: PrincipalRef,
        project_id: UUID,
        memo: dict,
    ):
        """The principal record. Within a request, read once (request memo); on a memo
        miss, read together with the likely membership in ONE `MGET`, so a warm
        decision costs one Redis round trip, as M1's cached decision did."""

        from oss.src.utils.caching import get_cache_many  # noqa: PLC0415

        if ("principal", principal) in memo:
            return memo[("principal", principal)]

        record_entry = self._principals.cache_entry(principal=principal)
        hint = self._role_user_hint(authority=authority, principal=principal)
        record = _MISSING
        if record_entry is not None:
            entries = [record_entry]
            if hint is not None:
                entries.append(
                    self._memberships.cache_entry(user_id=hint, project_id=project_id)
                )
            # The entries this request registered for later reads (the resource's
            # sharing entry, a list's grants) ride in the same round trip.
            extra = prefetch.pending()
            values = await get_cache_many(entries + extra)
            if values[0] is not None:
                record = self._principals.record_from_cache(values[0])
            if hint is not None and values[1:] and values[1] is not None:
                memo[("membership", hint, project_id)] = values[1].membership
            if extra:
                prefetch.store(extra, values[len(entries) :])
        if record is _MISSING:
            record = await self._principals.fetch_principal(principal=principal)
        memo[("principal", principal)] = record
        return record

    async def _membership(self, *, user_id: UUID, project_id: UUID, memo: dict):
        key = ("membership", user_id, project_id)
        if key in memo:
            return memo[key]
        membership = await self._memberships.resolve(
            user_id=user_id, project_id=project_id
        )
        memo[key] = membership
        return membership

    @staticmethod
    def _restrictions(
        *,
        authority: Optional[RunAuthority],
        principal: PrincipalRef,
        project_id: UUID,
    ) -> Optional[DecisionReason]:
        if authority is None:
            return None
        if authority.principal != principal:
            return DecisionReason.RESTRICTED_BY_AUTHORITY
        if authority.project_id != project_id:
            return DecisionReason.RESTRICTED_BY_AUTHORITY
        # M2 supports no agent restriction and never sets one. Refusing every
        # non-null value keeps a later writer from failing open on M2 pods, also at
        # boundaries that pass no resource.
        if authority.restrictions.agent is not None:
            return DecisionReason.RESTRICTED_BY_AUTHORITY
        return None

    @staticmethod
    def role_allows(
        *,
        role: Optional[str],
        action: Permission,
    ) -> bool:
        """Whether a member with this project role may do `action` (step 3 of `decide`
        for that role, without a principal): the owner role, or a role whose permissions
        include it. For the share dialog, which shows what a grant can do for each
        member."""

        if role == _OWNER_ROLE:
            return True
        if role is None or get_role(ROLE_SCOPE, role) is None:
            return False
        permissions = get_role_permissions(ROLE_SCOPE, role)
        return "*" in permissions or action.value in permissions

    async def _capability(
        self,
        *,
        membership: ProjectMembership,
        action: Action,
    ) -> Decision:
        # The organization owner passes, as a member.
        if membership.is_organization_owner:
            return Decision(allowed=True, reason=DecisionReason.ORGANIZATION_OWNER)

        role: Optional[str] = membership.role

        # The project owner role passes any check.
        if role == _OWNER_ROLE:
            return Decision(allowed=True, reason=DecisionReason.PROJECT_OWNER)

        # A role requirement matches the member's role exactly.
        if isinstance(action, RoleRequirement):
            if get_role(ROLE_SCOPE, action.role) is None:
                raise InvalidRoleRequirement()
            if role is not None and role == action.role:
                return Decision(allowed=True, reason=DecisionReason.ROLE)
            return Decision(allowed=False, reason=DecisionReason.MISSING_CAPABILITY)

        # A permission comes from the role's catalog entry.
        if not isinstance(action, Permission) or action not in list(Permission):
            raise InvalidPermission()

        if role is not None:
            if get_role(ROLE_SCOPE, role) is None:
                # An organization role slug the project catalog does not define gives
                # no permissions.
                log.warning(
                    "[access] undefined role slug",
                    role=role,
                    project_id=str(membership.project_id),
                )
            else:
                permissions = get_role_permissions(ROLE_SCOPE, role)
                if "*" in permissions or action.value in permissions:
                    return Decision(allowed=True, reason=DecisionReason.ROLE)

        return Decision(allowed=False, reason=DecisionReason.MISSING_CAPABILITY)

    # -- offered roles ----------------------------------------------------------------

    async def offered_roles(self, *, organization_id: UUID) -> OfferedRoles:
        """The roles an invite or a role change may set in this organization, and its
        floor role, from the project-scope catalog that the access check reads.

        A plan with the RBAC entitlement offers every catalog role but `owner`, with
        floor role `viewer`; OSS and the other plans offer admin and member, with floor
        role `member`. Ownership moves only through the transfer route. Stored roles
        outside the list keep working. The only reader of the RBAC entitlement for
        roles; not on the decision path. Raises `RbacEntitlementUnavailable` when the
        plan cannot be read, so no role write guesses."""

        if await self._rbac_entitlement.is_entitled(organization_id=organization_id):
            return OfferedRoles(
                roles=[
                    entry["role"]
                    for entry in get_roles(ROLE_SCOPE)
                    if entry["role"] != _OWNER_ROLE
                ],
                floor_role=DefaultRole.VIEWER.value,
            )
        return OfferedRoles(
            roles=[DefaultRole.ADMIN.value, DefaultRole.MEMBER.value],
            floor_role=DefaultRole.MEMBER.value,
        )

    async def require_offered_role(self, *, organization_id: UUID, role: str) -> None:
        """Refuse a role that `offered_roles` does not list for this organization: the
        one check of the invite and role-change routes."""

        offered = await self.offered_roles(organization_id=organization_id)
        if role not in offered.roles:
            raise RoleNotOffered()

    # -- audit ------------------------------------------------------------------------

    def _deny(
        self,
        *,
        authority: Optional[RunAuthority],
        principal: PrincipalRef,
        project_id: UUID,
        action: Optional[Action],
        resource: Optional[ResourceRef],
        reason: DecisionReason,
        role_user_id: Optional[UUID],
        context: Optional[RunContext],
    ) -> Decision:
        """Log a denial with ids and kinds only. Never a token, a header, raw claims or a
        raw envelope."""

        access = get_request_access()
        if context is None and access is not None and access.envelope is not None:
            context = access.envelope.context
        organization_id = authority.organization_id if authority else None
        log.info(
            "[access] denied",
            principal_kind=principal.kind.value,
            principal_id=str(principal.id),
            role_user_id=str(role_user_id) if role_user_id else None,
            credential_kind=access.credential_kind.value if access else None,
            organization_id=str(organization_id) if organization_id else None,
            project_id=str(project_id),
            action=_action_name(action) if action is not None else None,
            resource_kind=resource.kind.value if resource else None,
            resource_id=resource.id if resource else None,
            reason=reason.value,
            run_id=context.run_id if context else None,
            origin=context.origin.value if context else None,
            origin_id=context.origin_id if context else None,
        )
        return Decision(allowed=False, reason=reason)

    @staticmethod
    def _deny_resource(
        *,
        principal: PrincipalRef,
        project_id: UUID,
        action: Action,
        resource: ResourceRef,
        reason: DecisionReason,
        acting_user_id: UUID,
        context: Optional[RunContext],
    ) -> Decision:
        """Log a step 4 denial with ids and kinds only."""

        if context is None:
            access = get_request_access()
            if access is not None and access.envelope is not None:
                context = access.envelope.context
        log.info(
            "[sharing] resource denied",
            principal_kind=principal.kind.value,
            principal_id=str(principal.id),
            acting_user_id=str(acting_user_id),
            project_id=str(project_id),
            action=_action_name(action),
            resource_kind=resource.kind.value,
            resource_id=resource.id,
            reason=reason.value,
            run_id=context.run_id if context else None,
        )
        return Decision(allowed=False, reason=reason)


_access_service: Optional[AccessService] = None


async def read_user_principals_before_delete(
    *,
    user_id: UUID,
) -> Optional[UserPrincipals]:
    """Read what a user deletion must invalidate, before the delete. `None` (logged)
    when the read fails; the deletion goes on."""

    try:
        return await get_access_service().read_user_principals(user_id=user_id)
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning("[access] user principals read failed", user_id=str(user_id))
        return None


async def invalidate_user_after_delete(
    *,
    snapshot: Optional[UserPrincipals],
) -> None:
    """After a user deletion committed. A failure is logged and never fails it."""

    if snapshot is None:
        return
    try:
        await get_access_service().invalidate_user(snapshot=snapshot)
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning(
            "[access] principal invalidation failed",
            source="user_deletion",
            user_id=str(snapshot.user_id),
        )


async def read_scope_principals_before_delete(
    *,
    organization_ids: Sequence[UUID] = (),
    workspace_ids: Sequence[UUID] = (),
    project_ids: Sequence[UUID] = (),
) -> Optional[ScopePrincipals]:
    """Read what a cascade delete of these scopes must invalidate, before the delete.
    `None` (logged) when the read fails; the deletion goes on."""

    if not (organization_ids or workspace_ids or project_ids):
        return None
    try:
        return await get_access_service().read_scope_principals(
            organization_ids=organization_ids,
            workspace_ids=workspace_ids,
            project_ids=project_ids,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning("[access] scope principals read failed")
        return None


async def invalidate_scope_after_delete(
    *,
    snapshot: Optional[ScopePrincipals],
) -> None:
    """After a cascade delete committed. A failure is logged and never fails it."""

    if snapshot is None:
        return
    try:
        await get_access_service().invalidate_scope(snapshot=snapshot)
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning(
            "[access] principal invalidation failed",
            source="scope_deletion",
            project_count=len(snapshot.project_ids),
        )


async def invalidate_principals_after_write(*, principals, source: str) -> None:
    """For writers outside the access domain (keys, bindings, connections, users):
    clear the cached principal records after the commit. A failure, or a process that
    never registered the service, is logged and never fails the writer."""

    principals = list(principals)
    if not principals:
        return
    try:
        service = get_access_service()
        await service.invalidate_principals(principals=principals)
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning(
            "[access] principal invalidation failed",
            source=source,
            principal_count=len(principals),
        )


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
