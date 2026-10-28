from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, model_validator


# Every nullable field below has an explicit `= None` default: the cache serializer
# (`utils/caching.py::_serialize`) drops None fields, and a required field missing on
# read would turn every cache read into a miss.


class Visibility(str, Enum):
    PRIVATE = "private"
    PROJECT = "project"


class SessionRole(str, Enum):
    VIEWER = "viewer"
    PARTICIPANT = "participant"


class SharedItemKind(str, Enum):
    """The kind of item `initial_policy` decides for."""

    AGENT = "agent"
    SESSION = "session"
    CHANNEL_SESSION = "channel_session"


class EffectiveRole(str, Enum):
    """What the caller is on an item. Computed, never stored."""

    OWNER = "owner"
    PARTICIPANT = "participant"
    VIEWER = "viewer"
    NONE = "none"


class AccessPolicy(BaseModel):
    visibility: Visibility
    owner_user_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _private_needs_an_owner(self) -> "AccessPolicy":
        if self.visibility == Visibility.PRIVATE and self.owner_user_id is None:
            raise ValueError("A private item needs an owner.")
        return self


# The policy of every ownerless item: API keys, installations, subscriptions, child and
# evaluation runs, and the channel sessions of a project-visible agent.
OWNERLESS_PROJECT_POLICY = AccessPolicy(
    visibility=Visibility.PROJECT, owner_user_id=None
)


# -- sessions ---------------------------------------------------------------------------


class SessionGrant(BaseModel):
    stream_id: UUID
    user_id: UUID
    role: SessionRole
    created_at: Optional[datetime] = None
    created_by_id: Optional[UUID] = None


class UserSessionGrant(BaseModel):
    """One grant of a user, with the owner of its session (`list_user_grants`)."""

    stream_id: UUID
    owner_user_id: Optional[UUID] = None


class SessionPolicyState(BaseModel):
    """One read of the session row, whatever `deleted_at` and `archived_at` hold."""

    stream_id: UUID
    session_id: str
    policy: AccessPolicy
    # The channel binding (installation) of the session's newest thread; None when no
    # thread names it. Every thread of a session has the same binding.
    channel_binding_id: Optional[UUID] = None
    references_agent: bool  # session_streams.references names an agent

    @property
    def is_channel(self) -> bool:
        """A channel_threads row names this session."""
        return self.channel_binding_id is not None


class SessionTombstone(BaseModel):
    """A deleted private session (`session_trace_tombstones`): its records stay with
    tracing retention, so the id stays hidden from everyone but its former owner."""

    session_id: str
    owner_user_id: Optional[UUID] = None


class SessionGrantInput(BaseModel):
    user_id: UUID
    role: SessionRole


class SessionSharingChange(BaseModel):
    """A delta, applied under the row lock. "Only me" is PRIVATE + remove_all_grants."""

    visibility: Optional[Visibility] = None
    upsert_grants: List[SessionGrantInput] = []
    remove_user_ids: List[UUID] = []
    remove_all_grants: bool = False


class SessionSharingWriteResult(BaseModel):
    """The result of `set_session_sharing`. Carries the grant delta, so the service can
    invalidate the right user entries and publish the change without a second read."""

    state: SessionPolicyState
    before: AccessPolicy
    grants: List[SessionGrant]  # every grant after the write
    upserted: List[SessionGrantInput]  # grants added or changed
    removed_user_ids: List[UUID]  # grants actually removed


# -- agents -----------------------------------------------------------------------------


class AgentPolicyWriteResult(BaseModel):
    """The result of `set_agent_policy`."""

    policy: AccessPolicy


# -- read scopes ------------------------------------------------------------------------


class AgentReadScope(BaseModel):
    owner_user_id: Optional[UUID]  # principal.id for a human, else None


class SessionReadScope(BaseModel):
    owner_user_id: Optional[UUID]  # principal.id for a human, else None
    include_project: bool  # True for every principal kind
    granted_stream_ids: List[UUID]  # grants whose owner is an active member


# -- share disclosure (the sharing routes) ------------------------------------------------


class DisclosedConnection(BaseModel):
    """One gateway connection the agent's tools use (`build_share_disclosure`)."""

    provider: str
    integration: str
    connection: str  # the connection slug in the revision's tools


class ShareDisclosure(BaseModel):
    """What sharing an agent or a session lets others reach. The three statements are
    always true; the UI owns their text."""

    connections: List[DisclosedConnection]
    turns_use_run_credentials: bool = True
    files_and_tool_results_shared: bool = True
    trace_readers_can_read: bool = True


# -- sharing state (the sharing routes) ---------------------------------------------------


class AgentSharingState(BaseModel):
    policy: AccessPolicy
    owner_is_active: bool
    my_role: EffectiveRole  # OWNER, VIEWER or NONE for agents
    can_take_ownership: bool


class NotShareableReason(str, Enum):
    """Why a session cannot be shared (the reason of `SessionNotShareable`)."""

    CHANNEL = "channel"  # a channel session (for example Slack)
    OWNERLESS = "ownerless"  # no owner (an API key or an automation started it)
    NO_AGENT = "no_agent"  # no agent reference yet (before its first turn)
    # a run of the session used a person's own credential (M7); never shared after that
    PERSONAL_CREDENTIALS = "personal_credentials"


class SessionSharingState(BaseModel):
    policy: AccessPolicy
    owner_is_active: bool
    grants: List[SessionGrant]  # returned to the owner only; empty for others
    my_role: EffectiveRole
    can_send: bool
    shareable: bool  # False for channel, ownerless and non-agent sessions
    not_shareable_reason: Optional[NotShareableReason] = None  # None when shareable
    # On the one-session stream read only: whether the session's agent (its `workflow`
    # reference) is hidden from the caller. None when not computed.
    agent_hidden: Optional[bool] = None


# -- cache entries (never returned to callers) --------------------------------------------


class CachedAgentAccess(BaseModel):
    """Namespace `sharing_agent_access`, key (project_id, artifact_id)."""

    # None = "no agent_access row" (project-visible, ownerless): a hit, not a miss.
    policy: Optional[AccessPolicy] = None


class CachedSessionAccess(BaseModel):
    """Namespace `sharing_session_access`, key (project_id, session_id). Only a row is
    cached, never "no row"."""

    stream_id: Optional[UUID] = None
    # Never NULL for a row: a legacy row is assigned before it is cached.
    policy: Optional[AccessPolicy] = None
    grants: List[SessionGrant] = []  # every grant of the session; [] when none
    # A channel_threads row names the session (None: an entry written before this field).
    is_channel: Optional[bool] = None
    # That thread's channel binding (installation id); None when not known.
    channel_binding_id: Optional[UUID] = None


class CachedUserGrants(BaseModel):
    """Namespace `sharing_user_grants`, key (project_id, user_id). Written also when
    empty."""

    grants: List[UserSessionGrant]
