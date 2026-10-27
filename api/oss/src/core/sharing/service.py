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

from typing import Any, List, Optional, Sequence, Tuple, Type, Union
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.access.dtos import (
    Action,
    Decision,
    DecisionReason,
    PrincipalKind,
    PrincipalRef,
    RequestAccess,
    ResourceKind,
    ResourceRef,
    RunContext,
    RunOrigin,
)
from oss.src.core.access.interfaces import ResourcePolicyInterface
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.types import AccessDenied
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.sharing.audit import publish_sharing_event
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    AgentPolicyWriteResult,
    AgentReadScope,
    AgentSharingState,
    CachedAgentAccess,
    CachedSessionAccess,
    CachedUserGrants,
    EffectiveRole,
    NotShareableReason,
    SessionGrant,
    SessionPolicyState,
    SessionReadScope,
    SessionRole,
    SessionSharingChange,
    SessionSharingState,
    SessionSharingWriteResult,
    SharedItemKind,
    UserSessionGrant,
    Visibility,
    SessionTombstone,
)
from oss.src.core.access import prefetch
from oss.src.core.access.context import clear_request_memo, get_request_memo
from oss.src.core.sharing.interfaces import SharingDAOInterface
from oss.src.core.sharing.types import (
    InvalidGrantee,
    InvalidTransferTarget,
    OwnerStillActive,
    SessionNotShareable,
    SharedItemNotFound,
    SharingConflict,
    SharingServiceNotRegistered,
)
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


# The request memo key of a session the resource check found no row for. A route whose
# write creates the session checks the missing row, so a row that a concurrent request
# creates afterwards was never checked: the write rechecks it before it touches it.
_MISSING_SESSION_MEMO = "sharing_session_missing"


def _note_missing_session(*, project_id: UUID, session_id: str) -> None:
    memo = get_request_memo()
    if memo is not None:
        memo[(_MISSING_SESSION_MEMO, str(project_id), session_id)] = True


def session_was_missing(*, project_id: UUID, session_id: str) -> bool:
    """True when a resource check of this request found no row for the session. Free
    (the request memo, no read)."""

    memo = get_request_memo()
    return bool(memo and memo.get((_MISSING_SESSION_MEMO, str(project_id), session_id)))


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
    ):
        self._dao = sharing_dao
        self._memberships = memberships_service

    # -- resource rules (ResourcePolicyInterface, step 4 of decide) -----------------------

    async def evaluate(
        self,
        *,
        principal: PrincipalRef,
        action: Action,
        project_id: UUID,
        resource: ResourceRef,
        context: Optional[RunContext] = None,
    ) -> Optional[DecisionReason]:
        """The resource rules A1, A2, S1 to S4 (interfaces 3.1). None allows,
        `RESOURCE_DENIED` denies. Another resource kind, a session action outside the
        S1, S2 and S4 lists, and a missing row return None (the caller's not-found path
        answers). Warm calls read Redis only."""

        if resource.kind == ResourceKind.AGENT:
            return await self._evaluate_agent(
                principal=principal,
                action=action,
                project_id=project_id,
                resource_id=resource.id,
                context=context,
            )
        if resource.kind == ResourceKind.SESSION:
            return await self._evaluate_session(
                principal=principal,
                action=action,
                project_id=project_id,
                session_id=resource.id,
                context=context,
            )
        return None

    async def _evaluate_agent(
        self,
        *,
        principal: PrincipalRef,
        project_id: UUID,
        resource_id: str,
        action: Optional[Action] = None,
        context: Optional[RunContext] = None,
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
        # A2: private, only the human owner, and the owner's channel bindings running it
        # on their own channel turns: a private agent may answer a channel. Only the run
        # itself: the binding does not read, list or edit the private agent. A child run
        # of a channel turn is no channel turn.
        if _is_human(principal, policy.owner_user_id) or (
            action == Permission.RUN_WORKFLOWS
            and _is_channel_turn(principal, context)
            and _binding_creator(principal) == policy.owner_user_id
        ):
            return None
        return DecisionReason.RESOURCE_DENIED

    async def _evaluate_session(
        self,
        *,
        principal: PrincipalRef,
        action: Action,
        project_id: UUID,
        session_id: str,
        context: Optional[RunContext] = None,
    ) -> Optional[DecisionReason]:
        if not isinstance(action, Permission) or action not in (
            _SESSION_READ_ACTIONS | {Permission.RUN_SESSIONS, Permission.EDIT_SESSIONS}
        ):
            return None

        # The read assigns a legacy row its owner first, whatever the action.
        access, tombstone = await self._session_access_or_tombstone(
            project_id=project_id, session_id=session_id
        )
        if access is None and tombstone is not None:
            # A deleted private session: its records stay with tracing retention. Its
            # former owner may still read them; nobody may write to the id again (no
            # session is created over a tombstone), and everyone else is answered as
            # for a hidden session.
            if action in _SESSION_READ_ACTIONS and _is_human(
                principal, tombstone.owner_user_id
            ):
                return None
            return DecisionReason.RESOURCE_DENIED
        if access is None:
            _note_missing_session(project_id=project_id, session_id=session_id)
            return None  # no such session

        policy = access.policy
        owner = policy.owner_user_id
        if (
            access.is_channel
            and policy.visibility == Visibility.PRIVATE
            and principal.kind == PrincipalKind.INSTALLATION
            and _binding_creator(principal) == owner
        ):
            # S3: the channel session of a private agent belongs to the agent's owner;
            # the owner's own channel bindings read, run and edit it. (A project-visible
            # channel session is ownerless: S1, S2 and S4 let any binding act there.)
            return None
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
            if _project_members_send(policy=policy):
                # S2 for a project-visible session, a channel session included: every
                # member with the project capability sends and answers approvals (step 3
                # checked the capability; a send also checks the agent).
                allowed = True
            else:
                # S2 for a private session (it always has an owner): the active owner or
                # a participant.
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
        # The decision of this request read the caller's membership already: an owner
        # who is the caller costs no read.
        memo = get_request_memo()
        if memo is not None and ("membership", user_id, project_id) in memo:
            return memo[("membership", user_id, project_id)] is not None
        membership = await self._memberships.resolve(
            user_id=user_id, project_id=project_id
        )
        if memo is not None:
            # Kept for this request's later decisions (absence included).
            memo[("membership", user_id, project_id)] = membership
        return membership is not None

    async def _active_owners(self, *, owners: Sequence[UUID], project_id: UUID) -> set:
        """The owners that are active members. The ones this request has not read are read
        in one `MGET` (a miss is resolved one by one, as `_is_active` does)."""

        from oss.src.utils.caching import get_cache_many  # noqa: PLC0415

        memo = get_request_memo()
        active, unread = set(), []
        for owner in owners:
            if memo is not None and ("membership", owner, project_id) in memo:
                if memo[("membership", owner, project_id)] is not None:
                    active.add(owner)
            else:
                unread.append(owner)
        if not unread:
            return active
        values = [None] * len(unread)
        if len(unread) > 1:
            values = await get_cache_many(
                [
                    self._memberships.cache_entry(user_id=owner, project_id=project_id)
                    for owner in unread
                ]
            )
        for owner, value in zip(unread, values):
            if value is not None:
                membership = value.membership
            else:
                membership = await self._memberships.resolve(
                    user_id=owner, project_id=project_id
                )
            if memo is not None:
                memo[("membership", owner, project_id)] = membership
            is_active = membership is not None
            if is_active:
                active.add(owner)
        return active

    def prefetch(self, *, project_id: UUID, resource: ResourceRef) -> None:
        """Register the entry `evaluate` reads for this resource, for the decision's one
        cache read. No I/O."""

        if resource.kind == ResourceKind.SESSION:
            prefetch.register(session_access_entry(project_id, resource.id))
        elif resource.kind == ResourceKind.AGENT:
            try:
                artifact_id = UUID(resource.id)
            except ValueError:
                return
            prefetch.register(agent_access_entry(project_id, artifact_id))

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
        active_owners = await self._active_owners(
            owners=sorted(
                {g.owner_user_id for g in grants if g.owner_user_id is not None},
                key=str,
            ),
            project_id=project_id,
        )

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

        access, _ = await self._session_access_or_tombstone(
            project_id=project_id, session_id=session_id
        )
        return access

    async def _session_access_or_tombstone(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Tuple[Optional[CachedSessionAccess], Optional[SessionTombstone]]:
        """`_session_access`, and the session's tombstone when it has no row: the miss
        reads both in its one indexed read. Neither "no row" nor a tombstone is cached."""

        key = {"s": session_id}
        cached = await _get(
            namespace=SESSION_ACCESS_NAMESPACE,
            project_id=project_id,
            key=key,
            model=CachedSessionAccess,
        )
        if cached is not None and not cached.missing:
            return cached, None

        # "No row" is never cached: a cached absence would authorize a row an insert
        # created since (an insert path, an older pod or a lost write that does not
        # replace it). A missing session costs one indexed read, never a lock wait;
        # that read also answers whether a deleted private session left a tombstone.
        state, tombstone = await self._dao.fetch_session_policy_or_tombstone(
            project_id=project_id, session_id=session_id
        )
        if state is None:
            return None, tombstone

        entry = CachedSessionAccess(
            stream_id=state.stream_id,
            policy=state.policy,
            is_channel=state.is_channel,
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
        return entry, None

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

    # -- sharing state and writes (the sharing routes) ------------------------------------
    #
    # Every read here goes to the DAO, never the caches: `references` is filled by a
    # later heartbeat, so a cached `shareable` would be stale (deviation 16). Each write
    # reads `expected` from the DAO, decides, and hands both to the DAO's locked
    # compare-and-write. On `SharingConflict` it decides once more on the committed
    # policy and retries once; a second conflict propagates. After the commit: the
    # cache invalidation, then the audit event. Neither can fail the write.

    async def fetch_agent_sharing(
        self,
        *,
        project_id: UUID,
        principal: PrincipalRef,
        artifact_id: UUID,
    ) -> AgentSharingState:
        """The agent's sharing state for this principal. Raises `SharedItemNotFound`
        when the principal may not see the agent (A2). The caller checks that the
        artifact exists (no access row reads as project-visible and ownerless)."""

        policy = await self._dao.fetch_agent_policy(
            project_id=project_id, artifact_id=artifact_id
        )
        _require_visible_agent(principal=principal, policy=policy)
        return await self._agent_state(
            project_id=project_id, principal=principal, policy=policy
        )

    async def set_agent_visibility(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        access: RequestAccess,
        #
        artifact_id: UUID,
        visibility: Visibility,
    ) -> AgentSharingState:
        """Only the active human owner changes the visibility."""

        async def _decide(current: Optional[AccessPolicy]) -> AccessPolicy:
            owner = await self._require_active_owner(
                project_id=project_id, principal=access.principal, policy=current
            )
            return AccessPolicy(visibility=visibility, owner_user_id=owner)

        return await self._write_agent(
            organization_id=organization_id,
            project_id=project_id,
            access=access,
            artifact_id=artifact_id,
            decide=_decide,
        )

    async def transfer_agent(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        access: RequestAccess,
        #
        artifact_id: UUID,
        new_owner_user_id: UUID,
    ) -> AgentSharingState:
        """Only the active human owner transfers, to another active member. The
        visibility does not change. Raises `InvalidTransferTarget` for a target that
        is not an active member (an API key id, a departed user) or is the owner."""

        async def _decide(current: Optional[AccessPolicy]) -> AccessPolicy:
            owner = await self._require_active_owner(
                project_id=project_id, principal=access.principal, policy=current
            )
            if new_owner_user_id == owner or not await self._is_active(
                user_id=new_owner_user_id, project_id=project_id
            ):
                raise InvalidTransferTarget(user_id=new_owner_user_id)
            return AccessPolicy(
                visibility=current.visibility, owner_user_id=new_owner_user_id
            )

        return await self._write_agent(
            organization_id=organization_id,
            project_id=project_id,
            access=access,
            artifact_id=artifact_id,
            decide=_decide,
        )

    async def take_agent_ownership(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        access: RequestAccess,
        #
        artifact_id: UUID,
    ) -> AgentSharingState:
        """A human takes a project-visible agent that has no active owner; the
        result is `(PROJECT, caller)`. A private agent of a departed owner stays
        hidden (`SharedItemNotFound`); an active owner raises `OwnerStillActive`."""

        principal = access.principal

        async def _decide(current: Optional[AccessPolicy]) -> AccessPolicy:
            _require_visible_agent(principal=principal, policy=current)
            if principal.kind != PrincipalKind.HUMAN:
                raise _resource_denied()
            owner = current.owner_user_id if current is not None else None
            if await self._is_active(user_id=owner, project_id=project_id):
                raise OwnerStillActive()
            return AccessPolicy(
                visibility=Visibility.PROJECT, owner_user_id=principal.id
            )

        return await self._write_agent(
            organization_id=organization_id,
            project_id=project_id,
            access=access,
            artifact_id=artifact_id,
            decide=_decide,
        )

    async def fetch_session_sharing(
        self,
        *,
        project_id: UUID,
        principal: PrincipalRef,
        session_id: str,
    ) -> SessionSharingState:
        """The session's sharing state for this principal. `grants` only for the
        owner; `can_send` from rule S2 only (the router ANDs it with the full
        decision). Raises `SharedItemNotFound` for an unknown session or one the
        principal may not read (S1)."""

        state = await self._dao.fetch_session_policy(
            project_id=project_id, session_id=session_id
        )
        if state is None:
            raise SharedItemNotFound()
        grants = await self._dao.list_session_grants(
            project_id=project_id, stream_id=state.stream_id
        )
        return await self._visible_session_state(
            project_id=project_id, principal=principal, state=state, grants=grants
        )

    async def cached_session_sharing(
        self,
        *,
        project_id: UUID,
        principal: PrincipalRef,
        session_id: str,
        references_agent: bool,
    ) -> Optional[SessionSharingState]:
        """The caller's sharing state of a session, for the stream fetch the chat
        screen already makes: from the cached policy and grants (the route's decision
        read them, so no round trip), with `references_agent` from the row the route
        returns (it changes on the first beat, so it is never cached). `grants` only for
        the owner, as `fetch_session_sharing`. None when the session has no row or the
        caller may not read it."""

        access = await self._session_access(
            project_id=project_id, session_id=session_id
        )
        if access is None:
            return None
        is_channel = access.is_channel
        if is_channel is None:  # an ownerless session's first read of this field
            state = await self._dao.fetch_session_policy(
                project_id=project_id, session_id=session_id
            )
            if state is None:
                return None
            is_channel = state.is_channel
            # Kept in the entry, so the next read of the session makes no SQL read.
            await _set(
                namespace=SESSION_ACCESS_NAMESPACE,
                project_id=project_id,
                key={"s": session_id},
                value=access.model_copy(update={"is_channel": is_channel}),
            )
        state = SessionPolicyState(
            stream_id=access.stream_id,
            session_id=session_id,
            policy=access.policy,
            is_channel=is_channel,
            references_agent=references_agent,
        )
        try:
            sharing = await self._visible_session_state(
                project_id=project_id,
                principal=principal,
                state=state,
                grants=access.grants,
            )
        except SharedItemNotFound:
            return None
        # `grants` is the owner's only (the Share button shows how many people were added).
        return sharing

    async def set_session_sharing(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        access: RequestAccess,
        #
        session_id: str,
        change: SessionSharingChange,
    ) -> SessionSharingState:
        """Only the active human owner shares, and only a shareable session (has an
        owner, so not the ownerless channel session of a project agent, runs an agent). Grantees are active human
        members, not the owner, each named once in the change."""

        principal = access.principal
        state = await self._dao.fetch_session_policy(
            project_id=project_id, session_id=session_id
        )
        if state is None:
            raise SharedItemNotFound()
        grants = await self._dao.list_session_grants(
            project_id=project_id, stream_id=state.stream_id
        )
        await self._visible_session_state(
            project_id=project_id, principal=principal, state=state, grants=grants
        )
        reason = _not_shareable_reason(state)
        if reason is not None:
            raise SessionNotShareable(reason=reason.value)

        expected = state.policy
        result: Optional[SessionSharingWriteResult] = None
        for attempt in range(2):
            owner = await self._require_active_owner(
                project_id=project_id,
                principal=principal,
                policy=expected,
                readable=True,
            )
            await self._check_grantees(
                project_id=project_id, owner_user_id=owner, change=change
            )
            try:
                result = await self._dao.set_session_sharing(
                    project_id=project_id,
                    session_id=session_id,
                    expected=expected,
                    change=change,
                    user_id=principal.id,
                )
                break
            except SharingConflict as conflict:
                if attempt == 1 or conflict.current is None:
                    raise
                expected = conflict.current

        changed = (
            result.upserted
            or result.removed_user_ids
            or result.state.policy != result.before
        )
        if changed:
            await invalidate_sharing_caches(
                project_id=project_id,
                session_ids=[session_id],
                grant_user_ids=[
                    *(grant.user_id for grant in result.upserted),
                    *result.removed_user_ids,
                ],
            )
            await publish_sharing_event(
                organization_id=organization_id,
                project_id=project_id,
                access=access,
                resource=ResourceRef(kind=ResourceKind.SESSION, id=session_id),
                before=result.before,
                after=result.state.policy,
                grants_added=list(result.upserted),
                grants_removed=list(result.removed_user_ids),
            )

        return await self._session_state(
            project_id=project_id,
            principal=principal,
            state=result.state,
            grants=result.grants,
        )

    # -- sharing helpers ------------------------------------------------------------------

    async def _write_agent(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        access: RequestAccess,
        artifact_id: UUID,
        decide,
    ) -> AgentSharingState:
        """Read `expected`, decide, write; on a conflict decide once more on the
        committed policy and retry once. A decision equal to the current policy
        writes nothing."""

        principal = access.principal
        current = await self._dao.fetch_agent_policy(
            project_id=project_id, artifact_id=artifact_id
        )
        result: Optional[AgentPolicyWriteResult] = None
        for attempt in range(2):
            new = await decide(current)
            if new == current:
                return await self._agent_state(
                    project_id=project_id, principal=principal, policy=current
                )
            try:
                result = await self._dao.set_agent_policy(
                    project_id=project_id,
                    artifact_id=artifact_id,
                    expected=current,
                    policy=new,
                    user_id=principal.id,
                )
                break
            except SharingConflict as conflict:
                if attempt == 1:
                    raise
                current = conflict.current

        await invalidate_sharing_caches(
            project_id=project_id, artifact_ids=[artifact_id]
        )
        await publish_sharing_event(
            organization_id=organization_id,
            project_id=project_id,
            access=access,
            resource=ResourceRef(kind=ResourceKind.AGENT, id=str(artifact_id)),
            before=current,
            after=result.policy,
        )
        return await self._agent_state(
            project_id=project_id, principal=principal, policy=result.policy
        )

    async def _require_active_owner(
        self,
        *,
        project_id: UUID,
        principal: PrincipalRef,
        policy: Optional[AccessPolicy],
        readable: bool = False,
    ) -> UUID:
        """The owner, when the principal is the active human owner. Otherwise an item
        the principal may read is refused (`AccessDenied`, `resource_denied`) and a
        private one it may not read is hidden (`SharedItemNotFound`). A private agent
        is readable only by its owner; a session's readability is checked first by
        the caller (`readable=True`)."""

        owner = policy.owner_user_id if policy is not None else None
        if _is_human(principal, owner) and await self._is_active(
            user_id=owner, project_id=project_id
        ):
            return owner
        if (
            not readable
            and policy is not None
            and policy.visibility == Visibility.PRIVATE
        ):
            raise SharedItemNotFound()
        raise _resource_denied()

    async def _check_grantees(
        self,
        *,
        project_id: UUID,
        owner_user_id: UUID,
        change: SessionSharingChange,
    ) -> None:
        seen = set()
        for user_id in (
            *(grant.user_id for grant in change.upsert_grants),
            *change.remove_user_ids,
        ):
            if user_id in seen:
                raise InvalidGrantee(user_id=user_id, reason="duplicate")
            seen.add(user_id)
        for grant in change.upsert_grants:
            if grant.user_id == owner_user_id:
                raise InvalidGrantee(user_id=grant.user_id, reason="owner")
            # An API key or installation id is no member: only humans get grants.
            if not await self._is_active(user_id=grant.user_id, project_id=project_id):
                raise InvalidGrantee(user_id=grant.user_id, reason="not_member")

    async def _agent_state(
        self,
        *,
        project_id: UUID,
        principal: PrincipalRef,
        policy: Optional[AccessPolicy],
    ) -> AgentSharingState:
        effective = policy or OWNERLESS_PROJECT_POLICY
        owner = effective.owner_user_id
        owner_is_active = await self._is_active(user_id=owner, project_id=project_id)
        if _is_human(principal, owner):
            my_role = EffectiveRole.OWNER
        elif effective.visibility == Visibility.PROJECT:
            my_role = EffectiveRole.VIEWER
        else:
            my_role = EffectiveRole.NONE
        return AgentSharingState(
            policy=effective,
            owner_is_active=owner_is_active,
            my_role=my_role,
            can_take_ownership=(
                principal.kind == PrincipalKind.HUMAN
                and effective.visibility == Visibility.PROJECT
                and not owner_is_active
            ),
        )

    async def _visible_session_state(
        self,
        *,
        project_id: UUID,
        principal: PrincipalRef,
        state: SessionPolicyState,
        grants: List[SessionGrant],
    ) -> SessionSharingState:
        """`_session_state`, or `SharedItemNotFound` when rule S1 hides the session
        from the principal."""

        sharing = await self._session_state(
            project_id=project_id, principal=principal, state=state, grants=grants
        )
        if state.policy.visibility == Visibility.PRIVATE and not (
            sharing.owner_is_active
            and sharing.my_role
            in (
                EffectiveRole.OWNER,
                EffectiveRole.PARTICIPANT,
                EffectiveRole.VIEWER,
            )
        ):
            raise SharedItemNotFound()
        return sharing

    async def _session_state(
        self,
        *,
        project_id: UUID,
        principal: PrincipalRef,
        state: SessionPolicyState,
        grants: List[SessionGrant],
    ) -> SessionSharingState:
        policy = state.policy
        owner = policy.owner_user_id
        owner_is_active = await self._is_active(user_id=owner, project_id=project_id)
        is_owner = _is_human(principal, owner)
        grant_role = next(
            (
                grant.role
                for grant in grants
                if principal.kind == PrincipalKind.HUMAN
                and grant.user_id == principal.id
            ),
            None,
        )

        members_send = _project_members_send(policy=policy)
        if is_owner:
            my_role = EffectiveRole.OWNER
        elif members_send:
            # Project access gives Participant, above any grant (a Viewer grant stays
            # stored and applies again if the owner makes the session private).
            my_role = EffectiveRole.PARTICIPANT
        elif grant_role is not None and owner_is_active:
            # A grant works only while its owner is an active member.
            my_role = EffectiveRole(grant_role.value)
        elif policy.visibility == Visibility.PROJECT:
            my_role = EffectiveRole.VIEWER
        else:
            my_role = EffectiveRole.NONE

        # Rule S2: the router ANDs it with the full decision.
        if members_send:
            can_send = True
        else:
            can_send = owner_is_active and (
                is_owner or grant_role == SessionRole.PARTICIPANT
            )

        not_shareable_reason = _not_shareable_reason(state)
        return SessionSharingState(
            policy=policy,
            owner_is_active=owner_is_active,
            grants=list(grants) if is_owner else [],
            my_role=my_role,
            can_send=can_send,
            shareable=not_shareable_reason is None,
            not_shareable_reason=not_shareable_reason,
        )

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
        subscriptions, child and evaluation runs) and channel sessions: no owner,
        project-visible. The run that creates a channel session replaces this policy
        with `channel_session_policy` (the agent's owner owns the channel sessions of a
        private agent). An omitted visibility is PRIVATE when there is an owner. A
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


def _resource_denied() -> AccessDenied:
    """The caller may read the item but not do this write: 403 `access_denied`."""

    return AccessDenied(
        decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED)
    )


def _require_visible_agent(
    *, principal: PrincipalRef, policy: Optional[AccessPolicy]
) -> None:
    """Rules A1, A2: a private agent is hidden from all but its human owner."""

    if (
        policy is not None
        and policy.visibility == Visibility.PRIVATE
        and not _is_human(principal, policy.owner_user_id)
    ):
        raise SharedItemNotFound()


def _project_members_send(*, policy: AccessPolicy) -> bool:
    """Project visibility gives every member Participant (read, send, answer
    approvals), owned or ownerless, whether or not the owner is still a member, and
    whether or not the session came from a channel."""

    return policy.visibility == Visibility.PROJECT


def _binding_creator(principal: PrincipalRef) -> Optional[UUID]:
    """The user who created this channel binding: the acting user of the principal record
    that this decision read (the request memo; no I/O). None when the record is not in
    the memo (the caller then refuses)."""

    if principal.kind != PrincipalKind.INSTALLATION:
        return None
    memo = get_request_memo()
    record = memo.get(("principal", principal)) if memo is not None else None
    return getattr(record, "acting_user_id", None)


def _is_channel_turn(principal: PrincipalRef, context: Optional[RunContext]) -> bool:
    """The principal is a channel binding running its own channel turn (a resumed or
    queued one included; they keep the turn's origin)."""

    return (
        principal.kind == PrincipalKind.INSTALLATION
        and context is not None
        and context.origin == RunOrigin.INSTALLATION
    )


def _not_shareable_reason(state: SessionPolicyState) -> Optional[NotShareableReason]:
    # A channel session of a project agent has no owner and is the whole project's. The
    # channel session of a private agent belongs to the agent's owner, who may share it
    # like any other chat.
    if state.is_channel and state.policy.owner_user_id is None:
        return NotShareableReason.CHANNEL
    if state.policy.owner_user_id is None:
        return NotShareableReason.OWNERLESS
    if not state.references_agent:
        return NotShareableReason.NO_AGENT
    return None


def _is_human(principal: PrincipalRef, user_id: Optional[UUID]) -> bool:
    """The principal is this human (never an API key or installation of theirs)."""

    return (
        user_id is not None
        and principal.kind == PrincipalKind.HUMAN
        and principal.id == user_id
    )


def _entry(
    *,
    namespace: str,
    project_id: UUID,
    key: Union[str, dict],
    model: Type[BaseModel],
    user_id: Optional[UUID] = None,
) -> dict:
    return {
        "namespace": namespace,
        "project_id": str(project_id),
        "user_id": str(user_id) if user_id is not None else None,
        "key": key,
        "model": model,
    }


def session_access_entry(project_id: UUID, session_id: str) -> dict:
    return _entry(
        namespace=SESSION_ACCESS_NAMESPACE,
        project_id=project_id,
        key={"s": session_id},
        model=CachedSessionAccess,
    )


def agent_access_entry(project_id: UUID, artifact_id: UUID) -> dict:
    return _entry(
        namespace=AGENT_ACCESS_NAMESPACE,
        project_id=project_id,
        key={"a": str(artifact_id)},
        model=CachedAgentAccess,
    )


def user_grants_entry(project_id: UUID, user_id: UUID) -> dict:
    return _entry(
        namespace=USER_GRANTS_NAMESPACE,
        project_id=project_id,
        key=_USER_GRANTS_KEY,
        model=CachedUserGrants,
        user_id=user_id,
    )


def prefetch_session_read_scope(*, project_id: UUID, principal: PrincipalRef) -> None:
    """Register the grants entry a human's session list reads, before the route's
    decision, so the decision's one cache read reads it too. No I/O."""

    user_id = _human_id(principal)
    if user_id is not None:
        prefetch.register(user_grants_entry(project_id, user_id))


async def channel_session_policy(
    *, project_id: UUID, agent_artifact_id: Optional[UUID]
) -> AccessPolicy:
    """The policy of a session that a channel turn creates: private to the agent's owner
    when the agent is private, else project-visible and ownerless. Reads the agent's
    cached policy, which the turn's admission read in this request (no round trip)."""

    if agent_artifact_id is None:
        return OWNERLESS_PROJECT_POLICY
    policy = (
        await get_sharing_service().fetch_agent_policy_cached(
            project_id=project_id, artifact_id=agent_artifact_id
        )
    ).policy
    if policy is not None and policy.visibility == Visibility.PRIVATE:
        return policy
    return OWNERLESS_PROJECT_POLICY


def created_session_access(
    created: Any, *, requested: AccessPolicy, by_installation: bool
) -> Tuple[AccessPolicy, Optional[bool]]:
    """The policy and the channel flag of a row the insert just created, with the
    requested policy. A session created by a channel installation's run is a channel
    session (`channel_session_policy`); no other creator inserts a row a channel thread
    names. The flag is None when the insert did not say (the entry then reads the row
    once)."""

    if by_installation:
        return requested, True
    has_thread = getattr(created, "has_channel_thread", None)
    return requested, has_thread if isinstance(has_thread, bool) else None


async def cache_created_session_access(
    *,
    project_id: UUID,
    session_id: str,
    stream_id: Optional[UUID],
    policy: AccessPolicy,
    is_channel: Optional[bool] = None,
) -> None:
    """After the commit of the insert that created a session row: write its entry with a
    plain SET, over a cached "no row" (a new row has no grants). A failure is logged and
    never fails the insert; the entry then expires on its TTL."""

    try:
        if stream_id is None:
            raise ValueError("no stream id")
        value = CachedSessionAccess(
            stream_id=stream_id,
            policy=policy,
            grants=[],
            # The insert path knows it (a channel session is created by its installation's
            # run, see `created_session_access`); an owned session that no channel run
            # created is never one. None: read once from the row.
            is_channel=(
                is_channel
                if is_channel is not None
                else (False if policy.owner_user_id is not None else None)
            ),
        )
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning("[sharing] created session entry not built", session_id=session_id)
        await _invalidate(
            namespace=SESSION_ACCESS_NAMESPACE,
            project_id=project_id,
            key={"s": session_id},
        )
        return
    written = await _set(
        namespace=SESSION_ACCESS_NAMESPACE,
        project_id=project_id,
        key={"s": session_id},
        value=value,
    )
    if written is False:
        # A cached "no row" must not survive the row: delete it instead.
        await _invalidate(
            namespace=SESSION_ACCESS_NAMESPACE,
            project_id=project_id,
            key={"s": session_id},
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
    """One entry. From the request memo when this request read it already (or
    registered it for the decision's read); else one GET, never the cache lock: a miss
    is read from Postgres at once, it never waits for another reader."""

    entry = _entry(
        namespace=namespace,
        project_id=project_id,
        key=key,
        model=model,
        user_id=user_id,
    )
    found, value = await prefetch.read(entry)
    if found:
        return value
    try:
        value = await get_cache(
            namespace=namespace,
            project_id=str(project_id),
            user_id=str(user_id) if user_id is not None else None,
            key=key,
            model=model,
            retry=False,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        value = None
    prefetch.remember(entry, value)
    return value


async def _set(
    *,
    namespace: str,
    project_id: UUID,
    key: Union[str, dict],
    value: BaseModel,
    user_id: Optional[UUID] = None,
    nx: bool = False,
) -> bool:
    """True when the entry was written or caching is off; False on a Redis error (and
    on an `nx` write that found a value)."""
    written: Optional[bool] = False
    try:
        written = await set_cache(
            namespace=namespace,
            project_id=str(project_id),
            user_id=str(user_id) if user_id is not None else None,
            key=key,
            value=value,
            ttl=AGENTA_CACHE_TTL,
            nx=nx,
            release_lock=False,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        written = False
    if written is False or (written is None and _caching_enabled()):
        # Not stored (a Redis error, or an `nx` write that found a value): this request
        # must not treat its value as what the cache holds.
        prefetch.forget(
            _entry(
                namespace=namespace,
                project_id=project_id,
                key=key,
                model=type(value),
                user_id=user_id,
            )
        )
        return False
    prefetch.remember(
        _entry(
            namespace=namespace,
            project_id=project_id,
            key=key,
            model=type(value),
            user_id=user_id,
        ),
        value,
    )
    # set_cache answers None when caching is off, and None on its own Redis error.
    return written is not False and (written is not None or not _caching_enabled())


def _caching_enabled() -> bool:
    return bool(env.agenta.api.caching.enabled)


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

    # This request's later decisions read the written state, not what it read before.
    clear_request_memo()

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
