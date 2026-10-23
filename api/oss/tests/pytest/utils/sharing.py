"""Test helpers for the sharing domain (M3): an in-memory `SharingDAOInterface`, a
one-project `SharingWorld` and `AllowAllResourcePolicy`."""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple
from uuid import UUID, uuid4

from oss.src.core.access.dtos import Action, DecisionReason, PrincipalRef, ResourceRef
from oss.src.core.access.interfaces import ResourcePolicyInterface
from oss.src.core.sharing.dtos import (
    AccessPolicy,
    AgentPolicyWriteResult,
    SessionGrant,
    SessionReadScope,
    SessionGrantInput,
    SessionPolicyState,
    SessionSharingChange,
    SessionRole,
    SessionSharingWriteResult,
    UserSessionGrant,
    Visibility,
)
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.sharing.interfaces import SharingDAOInterface
from oss.src.core.sharing.service import SharingService
from oss.src.core.sharing.types import SharedItemNotFound, SharingConflict
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, make_summary
from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO


class AllowAllResourcePolicy(ResourcePolicyInterface):
    """A resource policy that allows every resource (step 4 of `decide` never denies),
    for tests of `AccessService` that are not about sharing. `calls` records each
    evaluation."""

    def __init__(self) -> None:
        self.calls: List[dict] = []

    async def evaluate(
        self,
        *,
        principal: PrincipalRef,
        action: Action,
        project_id: UUID,
        resource: ResourceRef,
    ) -> Optional[DecisionReason]:
        self.calls.append(
            {
                "principal": principal,
                "action": action,
                "project_id": project_id,
                "resource": resource,
            }
        )
        return None


class InMemorySharingDAO(SharingDAOInterface):
    """The policy rows in dicts, with the Postgres DAO's compare-and-write semantics
    (no locks: one event loop runs one call at a time).

    - `agents`: (project_id, artifact_id) -> policy. No entry = no access row.
    - `artifacts`: the (project_id, artifact_id) pairs that exist; `set_agent_policy`
      on another pair raises `SharedItemNotFound`. `add_agent` fills both.
    - `channel_agents`: (project_id, artifact_id) -> ids of the active channel agents
      bound to it; a PRIVATE write returns them and empties the list.
    - `sessions`: (project_id, session_id) -> state. `legacy_sessions` holds rows with
      `visibility NULL`, keyed the same way, with the state the owner rule assigns;
      `fetch_session_policy` moves them into `sessions`.
    - `grants`: (project_id, stream_id) -> grants.
    - `reads`: the method name of every call, in order.
    """

    def __init__(self) -> None:
        self.agents: Dict[Tuple[UUID, UUID], AccessPolicy] = {}
        self.artifacts: Set[Tuple[UUID, UUID]] = set()
        self.channel_agents: Dict[Tuple[UUID, UUID], List[UUID]] = {}
        self.sessions: Dict[Tuple[UUID, str], SessionPolicyState] = {}
        self.legacy_sessions: Dict[Tuple[UUID, str], SessionPolicyState] = {}
        self.grants: Dict[Tuple[UUID, UUID], List[SessionGrant]] = {}
        self.reads: List[str] = []

    # -- seeding ------------------------------------------------------------------------

    def add_agent(
        self,
        *,
        project_id: UUID,
        artifact_id: Optional[UUID] = None,
        policy: Optional[AccessPolicy] = None,
    ) -> UUID:
        artifact_id = artifact_id or uuid4()
        self.artifacts.add((project_id, artifact_id))
        if policy is not None:
            self.agents[(project_id, artifact_id)] = policy
        return artifact_id

    def add_session(
        self,
        *,
        project_id: UUID,
        policy: AccessPolicy,
        session_id: Optional[str] = None,
        stream_id: Optional[UUID] = None,
        is_channel: bool = False,
        references_agent: bool = True,
        legacy: bool = False,
    ) -> SessionPolicyState:
        state = SessionPolicyState(
            stream_id=stream_id or uuid4(),
            session_id=session_id or f"s-{uuid4().hex}",
            policy=policy,
            is_channel=is_channel,
            references_agent=references_agent,
        )
        target = self.legacy_sessions if legacy else self.sessions
        target[(project_id, state.session_id)] = state
        return state

    def add_grant(self, *, project_id: UUID, grant: SessionGrant) -> SessionGrant:
        self.grants.setdefault((project_id, grant.stream_id), []).append(grant)
        return grant

    # -- agents -------------------------------------------------------------------------

    async def fetch_agent_policy(
        self, *, project_id: UUID, artifact_id: UUID
    ) -> Optional[AccessPolicy]:
        self.reads.append("fetch_agent_policy")
        return self.agents.get((project_id, artifact_id))

    async def set_agent_policy(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        expected: Optional[AccessPolicy],
        policy: AccessPolicy,
        user_id: UUID,
    ) -> AgentPolicyWriteResult:
        self.reads.append("set_agent_policy")
        key = (project_id, artifact_id)
        if key not in self.artifacts:
            raise SharedItemNotFound()
        current = self.agents.get(key)
        if current != expected:
            raise SharingConflict(current=current)
        self.agents[key] = policy
        deactivated: List[UUID] = []
        if policy.visibility == Visibility.PRIVATE:
            deactivated = list(self.channel_agents.get(key, []))
            self.channel_agents[key] = []
        return AgentPolicyWriteResult(
            policy=policy, deactivated_channel_agent_ids=deactivated
        )

    # -- sessions -----------------------------------------------------------------------

    async def fetch_session_policy(
        self, *, project_id: UUID, session_id: str
    ) -> Optional[SessionPolicyState]:
        self.reads.append("fetch_session_policy")
        if (project_id, session_id) in self.legacy_sessions:
            await self.assign_legacy_session_access(
                project_id=project_id, session_id=session_id
            )
        return self.sessions.get((project_id, session_id))

    async def assign_legacy_session_access(
        self, *, project_id: UUID, session_id: str
    ) -> None:
        self.reads.append("assign_legacy_session_access")
        state = self.legacy_sessions.pop((project_id, session_id), None)
        if state is not None:
            self.sessions[(project_id, session_id)] = state

    async def list_session_grants(
        self, *, project_id: UUID, stream_id: UUID
    ) -> List[SessionGrant]:
        self.reads.append("list_session_grants")
        return list(self.grants.get((project_id, stream_id), []))

    async def list_user_grants(
        self, *, project_id: UUID, user_id: UUID
    ) -> List[UserSessionGrant]:
        self.reads.append("list_user_grants")
        owners = {
            state.stream_id: state.policy.owner_user_id
            for (p, _), state in self.sessions.items()
            if p == project_id
        }
        return [
            UserSessionGrant(stream_id=stream_id, owner_user_id=owners.get(stream_id))
            for (p, stream_id), grants in self.grants.items()
            if p == project_id
            for grant in grants
            if grant.user_id == user_id
        ]

    async def set_session_sharing(
        self,
        *,
        project_id: UUID,
        session_id: str,
        expected: AccessPolicy,
        change: SessionSharingChange,
        user_id: UUID,
    ) -> SessionSharingWriteResult:
        self.reads.append("set_session_sharing")
        key = (project_id, session_id)
        if key in self.legacy_sessions:
            await self.assign_legacy_session_access(
                project_id=project_id, session_id=session_id
            )
        state = self.sessions.get(key)
        if state is None:
            raise SharedItemNotFound()
        before = state.policy
        if before != expected:
            raise SharingConflict(current=before)

        old = {g.user_id: g for g in self.grants.get((project_id, state.stream_id), [])}
        new = _apply_grant_change(
            old=old,
            change=change,
            stream_id=state.stream_id,
            user_id=user_id,
        )
        policy = AccessPolicy(
            visibility=change.visibility or before.visibility,
            owner_user_id=before.owner_user_id,
        )
        state = state.model_copy(update={"policy": policy})
        self.sessions[key] = state
        self.grants[(project_id, state.stream_id)] = list(new.values())
        return _write_result(state=state, before=before, old=old, new=new)


def _apply_grant_change(
    *,
    old: Dict[UUID, SessionGrant],
    change: SessionSharingChange,
    stream_id: UUID,
    user_id: UUID,
) -> Dict[UUID, SessionGrant]:
    """The grants after `change`: removals first, then upserts (an upsert keeps the
    grant's creation fields and changes its role)."""

    if change.remove_all_grants:
        new: Dict[UUID, SessionGrant] = {}
    else:
        new = {u: g for u, g in old.items() if u not in set(change.remove_user_ids)}
    for item in change.upsert_grants:
        kept = new.get(item.user_id) or old.get(item.user_id)
        new[item.user_id] = (
            kept.model_copy(update={"role": item.role})
            if kept is not None
            else SessionGrant(
                stream_id=stream_id,
                user_id=item.user_id,
                role=item.role,
                created_at=datetime.now(timezone.utc),
                created_by_id=user_id,
            )
        )
    return new


def _write_result(
    *,
    state: SessionPolicyState,
    before: AccessPolicy,
    old: Dict[UUID, SessionGrant],
    new: Dict[UUID, SessionGrant],
) -> SessionSharingWriteResult:
    return SessionSharingWriteResult(
        state=state,
        before=before,
        grants=list(new.values()),
        upserted=[
            SessionGrantInput(user_id=u, role=g.role)
            for u, g in new.items()
            if u not in old or old[u].role != g.role
        ],
        removed_user_ids=[u for u in old if u not in new],
    )


class SharingWorld:
    """One project with a `SharingService` over `InMemorySharingDAO` and a real
    `MembershipsService` over `InMemoryMembershipsDAO` (PROJECT_ROWS policy).
    `add_member` and `remove_member` change who is an active member."""

    def __init__(self) -> None:
        self.organization_id = uuid4()
        self.project_id = uuid4()
        self.memberships_dao = InMemoryMembershipsDAO()
        self.memberships_dao.add_project(
            make_summary(
                organization_id=self.organization_id, project_id=self.project_id
            )
        )
        self.dao = InMemorySharingDAO()
        self.service = SharingService(
            sharing_dao=self.dao,
            memberships_service=MembershipsService(
                memberships_dao=self.memberships_dao,
                policy=MembershipPolicy.PROJECT_ROWS,
            ),
            principals_dao=InMemoryPrincipalsDAO(),
        )

    def add_member(self, user_id: UUID, role: str = "editor") -> UUID:
        self.memberships_dao.add_organization_member(
            organization_id=self.organization_id, user_id=user_id, role=role
        )
        self.memberships_dao.add_project_member(
            project_id=self.project_id, user_id=user_id, role=role
        )
        return user_id

    def remove_member(self, user_id: UUID) -> None:
        self.memberships_dao.organization_members = [
            m for m in self.memberships_dao.organization_members if m.user_id != user_id
        ]
        self.memberships_dao.project_members = [
            m for m in self.memberships_dao.project_members if m.user_id != user_id
        ]

    def add_session(self, *, policy: AccessPolicy, **kwargs) -> SessionPolicyState:
        return self.dao.add_session(project_id=self.project_id, policy=policy, **kwargs)

    def add_grant(
        self, *, state: SessionPolicyState, user_id: UUID, role: SessionRole
    ) -> SessionGrant:
        return self.dao.add_grant(
            project_id=self.project_id,
            grant=SessionGrant(stream_id=state.stream_id, user_id=user_id, role=role),
        )


def register_sharing_service_for_tests(monkeypatch) -> SharingService:
    """Registers the `SharingService` of a fresh `SharingWorld` as the process's
    service, for code that calls `get_sharing_service()` (the trigger dispatcher,
    `policy_for_request`) in tests that run no `bootstrap_access()`."""

    import oss.src.core.sharing.service as service_module  # noqa: PLC0415

    service = SharingWorld().service
    monkeypatch.setattr(service_module, "_sharing_service", service)
    return service


# The read scope of a caller that acts for no person: every project-visible session
# and no private one.
PROJECT_SESSION_SCOPE = SessionReadScope(
    owner_user_id=None, include_project=True, granted_stream_ids=[]
)


class ProjectAgentResolver:
    """A `workflows_service` for `ChannelsService` in tests that are not about sharing:
    every binding resolves to one agent (`artifact_id`). With no access row that agent
    is project-visible, so the activation guard lets the write through. `calls` holds
    the references of each resolution."""

    def __init__(self, artifact_id: Optional[UUID] = None) -> None:
        self.artifact_id = artifact_id or uuid4()
        self.calls: List[list] = []

    async def resolve_agent_artifact_id(self, *, project_id, references):
        self.calls.append(list(references or []))
        return self.artifact_id


class NoopRunAdmission:
    """A `RunAdmission` that admits every run and records nothing, for tests that are
    not about admission."""

    async def admit(self, **_kwargs) -> None:
        return None

    async def admit_turn(self, **_kwargs) -> None:
        return None

    async def admit_request(self, **_kwargs) -> None:
        return None


class RecordingRunAdmission:
    """A `RunAdmission` that records each call as `(method, kwargs)` in `calls`.

    `refuse(method, kwargs)` returns the exception a call raises (an `AdmissionDenied`
    or an `AgentReferenceUnresolved`), or None to admit. `before(method, kwargs)`, when
    set, is awaited first (a test uses it to order a race). `readable(kwargs)` answers
    `session_readable` (True when not set)."""

    def __init__(self, *, refuse=None, before=None, readable=None) -> None:
        self.calls: List[Tuple[str, dict]] = []
        self._refuse = refuse
        self._before = before
        self._readable = readable

    async def _record(self, method: str, kwargs: dict) -> None:
        self.calls.append((method, kwargs))
        if self._before is not None:
            await self._before(method, kwargs)
        if self._refuse is not None:
            error = self._refuse(method, kwargs)
            if error is not None:
                raise error

    async def admit(self, **kwargs) -> None:
        await self._record("admit", kwargs)

    async def admit_turn(self, **kwargs) -> None:
        await self._record("admit_turn", kwargs)

    async def admit_request(self, **kwargs) -> None:
        await self._record("admit_request", kwargs)

    async def session_readable(self, **kwargs) -> bool:
        self.calls.append(("session_readable", kwargs))
        return self._readable(kwargs) if self._readable is not None else True

    def methods(self) -> List[str]:
        return [method for method, _ in self.calls]


class RuleAccessService:
    """An `AccessService` stand-in for `RunAdmission` tests: `rule(principal, action,
    resource)` returns True to allow. `decide_calls` records each decision."""

    def __init__(self, rule) -> None:
        self._rule = rule
        self.decide_calls: List[dict] = []

    async def decide(
        self, *, authority, principal, action, project_id=None, resource=None
    ):
        from oss.src.core.access.dtos import Decision  # noqa: PLC0415

        self.decide_calls.append(
            {"principal": principal, "action": action, "resource": resource}
        )
        if self._rule(principal, action, resource):
            return Decision(allowed=True, reason=DecisionReason.ROLE)
        return Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED)
