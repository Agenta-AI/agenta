"""The sharing domain service: the ownership rule, the resource rules, the read scopes
and the policy caches.

Caches (TTL `AGENTA_CACHE_TTL`): `sharing_agent_access` (an agent's policy, "no row"
included), `sharing_session_access` (a session's policy and grants; a missing session is
never cached) and `sharing_user_grants` (a user's grants in a project, empty included).
No cache stores a decision. Every sharing write and every session delete calls
`invalidate_sharing_caches` after its commit. A sharing change takes effect at the next
decision; it can take up to `AGENTA_CACHE_TTL` (300 s) when the Redis invalidation fails
or when a read that started before the write committed refills the old entry after the
invalidation.
"""

from typing import Any, List, Optional, Sequence, Type, Union
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.access.dtos import (
    Action,
    DecisionReason,
    PrincipalKind,
    PrincipalRef,
    ResourceKind,
    ResourceRef,
    RunOrigin,
)
from oss.src.core.access.interfaces import (
    PrincipalsDAOInterface,
    ResourcePolicyInterface,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    AgentReadScope,
    CachedAgentAccess,
    CachedSessionAccess,
    CachedUserGrants,
    SessionGrant,
    SessionReadScope,
    SessionRole,
    SharedItemKind,
    UserSessionGrant,
    Visibility,
)
from oss.src.core.sharing.interfaces import SharingDAOInterface
from oss.src.core.sharing.types import SharingServiceNotRegistered
from oss.src.utils.caching import (
    AGENTA_CACHE_TTL,
    get_cache,
    invalidate_cache,
    set_cache,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


AGENT_ACCESS_NAMESPACE = "sharing_agent_access"
SESSION_ACCESS_NAMESPACE = "sharing_session_access"
USER_GRANTS_NAMESPACE = "sharing_user_grants"
# One `sharing_user_grants` entry per (project, user), with a fixed key, so one entry can
# be deleted directly by its name.
_USER_GRANTS_KEY = "grants"

# Rule S1: the actions that only read a session.
_SESSION_READ_ACTIONS = frozenset(
    {Permission.VIEW_SESSIONS, Permission.USE_MOUNTS, Permission.VIEW_MOUNTS}
)


# The origins where a turn's sender owns what the turn creates.
_SENDER_OWNS_ORIGINS = (RunOrigin.WEB, RunOrigin.API)
# The origins where a human principal owns what it creates without a sender.
_HUMAN_OWNS_ORIGINS = (RunOrigin.WEB, RunOrigin.SCHEDULE)


class SharingService(ResourcePolicyInterface):
    """The sharing domain: the ownership rule, the resource rules, the read scopes and
    the sharing writes. `bootstrap_access()` builds it before `WorkflowsService` exists,
    so it never reads revisions and never calls `AccessService` (it is the resource
    policy of `AccessService`)."""

    def __init__(
        self,
        *,
        sharing_dao: SharingDAOInterface,
        memberships_service: MembershipsService,
        principals_dao: PrincipalsDAOInterface,
    ):
        self._dao = sharing_dao
        self._memberships = memberships_service
        # For the principal-cache invalidation after a make-private deactivates
        # channel agents.
        self._principals_dao = principals_dao

    # -- resource rules (ResourcePolicyInterface, step 4 of decide) -----------------------

    async def evaluate(
        self,
        *,
        principal: PrincipalRef,
        action: Action,
        project_id: UUID,
        resource: ResourceRef,
    ) -> Optional[DecisionReason]:
        """The resource rules A1, A2, S1 to S4 (interfaces 3.1). None allows,
        `RESOURCE_DENIED` denies. Another resource kind, a session action outside the
        S1, S2 and S4 lists, and a missing row return None (the caller's not-found path
        answers). Warm calls read Redis only."""

        if resource.kind == ResourceKind.AGENT:
            return await self._evaluate_agent(
                principal=principal, project_id=project_id, resource_id=resource.id
            )
        if resource.kind == ResourceKind.SESSION:
            return await self._evaluate_session(
                principal=principal,
                action=action,
                project_id=project_id,
                session_id=resource.id,
            )
        return None

    async def _evaluate_agent(
        self,
        *,
        principal: PrincipalRef,
        project_id: UUID,
        resource_id: str,
    ) -> Optional[DecisionReason]:
        try:
            artifact_id = UUID(resource_id)
        except ValueError:
            return None  # no such agent

        policy = (
            await self.fetch_agent_policy_cached(
                project_id=project_id, artifact_id=artifact_id
            )
        ).policy

        # A1: no row, or project-visible.
        if policy is None or policy.visibility == Visibility.PROJECT:
            return None
        # A2: private, only the human owner.
        if _is_human(principal, policy.owner_user_id):
            return None
        return DecisionReason.RESOURCE_DENIED

    async def _evaluate_session(
        self,
        *,
        principal: PrincipalRef,
        action: Action,
        project_id: UUID,
        session_id: str,
    ) -> Optional[DecisionReason]:
        if not isinstance(action, Permission) or action not in (
            _SESSION_READ_ACTIONS | {Permission.RUN_SESSIONS, Permission.EDIT_SESSIONS}
        ):
            return None

        # The read assigns a legacy row its owner first, whatever the action.
        access = await self._session_access(
            project_id=project_id, session_id=session_id
        )
        if access is None:
            return None  # no such session

        policy = access.policy
        owner = policy.owner_user_id
        is_owner = _is_human(principal, owner)
        grant_role = next(
            (
                grant.role
                for grant in access.grants
                if principal.kind == PrincipalKind.HUMAN
                and grant.user_id == principal.id
            ),
            None,
        )

        if action in _SESSION_READ_ACTIONS:
            # S1: project-visible, or private with an active owner and the caller is
            # the owner or holds a grant.
            if policy.visibility == Visibility.PROJECT:
                return None
            allowed = (is_owner or grant_role is not None) and await self._is_active(
                user_id=owner, project_id=project_id
            )

        elif action == Permission.RUN_SESSIONS:
            if owner is None:
                # S2 for non-humans, S3 for humans: humans only read ownerless
                # sessions.
                allowed = principal.kind != PrincipalKind.HUMAN
            else:
                # S2: the active owner or a participant.
                allowed = (
                    is_owner or grant_role == SessionRole.PARTICIPANT
                ) and await self._is_active(user_id=owner, project_id=project_id)

        else:  # EDIT_SESSIONS
            # S4: owner set: only the active human owner; owner NULL: any principal.
            allowed = owner is None or (
                is_owner and await self._is_active(user_id=owner, project_id=project_id)
            )

        return None if allowed else DecisionReason.RESOURCE_DENIED

    async def _is_active(self, *, user_id: Optional[UUID], project_id: UUID) -> bool:
        """Rule "owner active": the owner is a member of the project, read through
        the `resolve_membership` cache."""

        if user_id is None:
            return False
        return await self._memberships.is_member(user_id=user_id, project_id=project_id)

    # -- read scopes ------------------------------------------------------------------------

    async def agent_read_scope(self, *, principal: PrincipalRef) -> AgentReadScope:
        """Private agents a list shows: the principal's own, for a human. No I/O."""

        return AgentReadScope(owner_user_id=_human_id(principal))

    async def session_read_scope(
        self,
        *,
        project_id: UUID,
        principal: PrincipalRef,
    ) -> SessionReadScope:
        """Sessions a list shows besides project-visible ones: the human's own private
        sessions and the sessions granted to them whose owner is an active member."""

        user_id = _human_id(principal)
        if user_id is None:
            return SessionReadScope(
                owner_user_id=None, include_project=True, granted_stream_ids=[]
            )

        grants = await self._user_grants(project_id=project_id, user_id=user_id)
        active_owners = set()
        for owner in {g.owner_user_id for g in grants if g.owner_user_id is not None}:
            if await self._is_active(user_id=owner, project_id=project_id):
                active_owners.add(owner)

        return SessionReadScope(
            owner_user_id=user_id,
            include_project=True,
            granted_stream_ids=[
                g.stream_id for g in grants if g.owner_user_id in active_owners
            ],
        )

    async def list_session_grants(
        self,
        *,
        project_id: UUID,
        stream_id: UUID,
    ) -> List[SessionGrant]:
        """The session's grants, from the DAO (uncached): what a session delete reads
        before the delete, so it can clear the grantees' cache entries after it."""

        return await self._dao.list_session_grants(
            project_id=project_id, stream_id=stream_id
        )

    # -- cached readers -------------------------------------------------------------------

    async def fetch_agent_policy_cached(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
    ) -> CachedAgentAccess:
        """The agent's policy through `sharing_agent_access`. "No row"
        (`policy=None`) is cached too."""

        key = {"a": str(artifact_id)}
        cached = await _get(
            namespace=AGENT_ACCESS_NAMESPACE,
            project_id=project_id,
            key=key,
            model=CachedAgentAccess,
        )
        if cached is not None:
            return cached

        entry = CachedAgentAccess(
            policy=await self._dao.fetch_agent_policy(
                project_id=project_id, artifact_id=artifact_id
            )
        )
        await _set(
            namespace=AGENT_ACCESS_NAMESPACE,
            project_id=project_id,
            key=key,
            value=entry,
        )
        return entry

    async def _session_access(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[CachedSessionAccess]:
        """The session's policy and grants through `sharing_session_access`. None when
        no row exists; that answer is never cached. A legacy row is assigned by
        `fetch_session_policy` before it is cached."""

        key = {"s": session_id}
        cached = await _get(
            namespace=SESSION_ACCESS_NAMESPACE,
            project_id=project_id,
            key=key,
            model=CachedSessionAccess,
        )
        if cached is not None:
            return cached

        state = await self._dao.fetch_session_policy(
            project_id=project_id, session_id=session_id
        )
        if state is None:
            return None

        entry = CachedSessionAccess(
            stream_id=state.stream_id,
            policy=state.policy,
            grants=await self._dao.list_session_grants(
                project_id=project_id, stream_id=state.stream_id
            ),
        )
        await _set(
            namespace=SESSION_ACCESS_NAMESPACE,
            project_id=project_id,
            key=key,
            value=entry,
        )
        return entry

    async def _user_grants(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> List[UserSessionGrant]:
        """The user's grants in the project through `sharing_user_grants`, written also
        when empty."""

        cached = await _get(
            namespace=USER_GRANTS_NAMESPACE,
            project_id=project_id,
            user_id=user_id,
            key=_USER_GRANTS_KEY,
            model=CachedUserGrants,
        )
        if cached is not None:
            return cached.grants

        grants = await self._dao.list_user_grants(
            project_id=project_id, user_id=user_id
        )
        await _set(
            namespace=USER_GRANTS_NAMESPACE,
            project_id=project_id,
            user_id=user_id,
            key=_USER_GRANTS_KEY,
            value=CachedUserGrants(grants=grants),
        )
        return grants

    # -- ownership rule -------------------------------------------------------------------

    def initial_policy(
        self,
        *,
        principal: PrincipalRef,
        origin: RunOrigin,
        sender_user_id: Optional[UUID],
        #
        kind: SharedItemKind,
        requested: Optional[Visibility] = None,
    ) -> AccessPolicy:
        """The policy of a new agent or session (CONTRACT section 7). Pure, never
        raises.

        In this order: (1) a turn with a sender and origin `web` or `api`: the sender
        owns; (2) a human principal on `web` or `schedule`: that human owns; (3)
        anything else (API keys, installations even with a linked sender,
        subscriptions, child and evaluation runs) and every channel session: no owner,
        project-visible. An omitted visibility is PRIVATE when there is an owner. A
        requested PRIVATE without an owner is dropped."""

        owner = _owner(
            principal=principal,
            origin=origin,
            sender_user_id=sender_user_id,
            kind=kind,
        )
        if owner is None:
            return OWNERLESS_PROJECT_POLICY
        return AccessPolicy(
            visibility=requested or Visibility.PRIVATE,
            owner_user_id=owner,
        )


def _is_human(principal: PrincipalRef, user_id: Optional[UUID]) -> bool:
    """The principal is this human (never an API key or installation of theirs)."""

    return (
        user_id is not None
        and principal.kind == PrincipalKind.HUMAN
        and principal.id == user_id
    )


def _human_id(principal: PrincipalRef) -> Optional[UUID]:
    return principal.id if principal.kind == PrincipalKind.HUMAN else None


def _owner(
    *,
    principal: PrincipalRef,
    origin: RunOrigin,
    sender_user_id: Optional[UUID],
    kind: SharedItemKind,
) -> Optional[UUID]:
    if kind == SharedItemKind.CHANNEL_SESSION or origin == RunOrigin.INSTALLATION:
        return None
    if sender_user_id is not None and origin in _SENDER_OWNS_ORIGINS:
        return sender_user_id
    if principal.kind == PrincipalKind.HUMAN and origin in _HUMAN_OWNS_ORIGINS:
        return principal.id
    return None


# -- cache helpers -------------------------------------------------------------------------
#
# A cache error is a miss on read and is ignored on write: the caller reads the DAO and
# decides from the row, so a Redis failure never allows what the row denies.


async def _get(
    *,
    namespace: str,
    project_id: UUID,
    key: Union[str, dict],
    model: Type[BaseModel],
    user_id: Optional[UUID] = None,
) -> Optional[Any]:
    try:
        return await get_cache(
            namespace=namespace,
            project_id=str(project_id),
            user_id=str(user_id) if user_id is not None else None,
            key=key,
            model=model,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        return None


async def _set(
    *,
    namespace: str,
    project_id: UUID,
    key: Union[str, dict],
    value: BaseModel,
    user_id: Optional[UUID] = None,
) -> None:
    try:
        await set_cache(
            namespace=namespace,
            project_id=str(project_id),
            user_id=str(user_id) if user_id is not None else None,
            key=key,
            value=value,
            ttl=AGENTA_CACHE_TTL,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        pass


async def _invalidate(
    *,
    namespace: str,
    project_id: UUID,
    key: Union[str, dict],
    user_id: Optional[UUID] = None,
) -> None:
    try:
        cleared = await invalidate_cache(
            namespace=namespace,
            key=key,
            project_id=str(project_id),
            user_id=str(user_id) if user_id is not None else None,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        cleared = None
    if cleared is None:
        log.warning(
            "[sharing] cache invalidation failed",
            namespace=namespace,
            project_id=str(project_id),
        )


async def invalidate_sharing_caches(
    *,
    project_id: UUID,
    artifact_ids: Sequence[UUID] = (),
    session_ids: Sequence[str] = (),
    grant_user_ids: Sequence[UUID] = (),
) -> None:
    """Clear the policy entries of these agents and sessions and the grant entries of
    these users in the project. Called after the commit of every sharing write and
    every session delete. A failure is logged and never fails the writer."""

    if not env.agenta.api.caching.enabled:
        # Nothing is cached, so nothing can be stale.
        return

    for artifact_id in artifact_ids:
        await _invalidate(
            namespace=AGENT_ACCESS_NAMESPACE,
            project_id=project_id,
            key={"a": str(artifact_id)},
        )
    for session_id in session_ids:
        await _invalidate(
            namespace=SESSION_ACCESS_NAMESPACE,
            project_id=project_id,
            key={"s": session_id},
        )
    for user_id in grant_user_ids:
        await _invalidate(
            namespace=USER_GRANTS_NAMESPACE,
            project_id=project_id,
            user_id=user_id,
            key=_USER_GRANTS_KEY,
        )


# -- registry ------------------------------------------------------------------------------


_sharing_service: Optional[SharingService] = None


def register_sharing_service(*, sharing_service: SharingService) -> None:
    global _sharing_service
    _sharing_service = sharing_service


def get_sharing_service() -> SharingService:
    if _sharing_service is None:
        raise SharingServiceNotRegistered(
            "SharingService is not registered. "
            "Call entrypoints.access.bootstrap_access() at process startup."
        )
    return _sharing_service
