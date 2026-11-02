from abc import ABC, abstractmethod
from typing import List, Optional, Tuple
from uuid import UUID

from oss.src.core.sharing.dtos import (
    AccessPolicy,
    AgentPolicyWriteResult,
    SessionGrant,
    SessionPolicyState,
    SessionSharingChange,
    SessionSharingWriteResult,
    SessionTombstone,
    UserSessionGrant,
)


class SharingDAOInterface(ABC):
    """The policy rows of agents (`agent_access`) and sessions (`session_streams`
    `visibility`/`owner_user_id`, `session_grants`). Uncached: `SharingService` owns the
    caches. Writers lock the item's row, compare it with `expected`, and raise
    `SharingConflict(current)` on a mismatch.

    `ensure_first_agent_access` is not here: it lives on `WorkflowsDAOInterface`, which
    owns the revision commit path."""

    # -- agents -------------------------------------------------------------------------

    @abstractmethod
    async def fetch_agent_policy(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
    ) -> Optional[AccessPolicy]:
        """None when the agent has no access row (project-visible, ownerless)."""

    @abstractmethod
    async def set_agent_policy(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        #
        expected: Optional[AccessPolicy],  # None = "no row"
        policy: AccessPolicy,
        #
        user_id: UUID,
    ) -> AgentPolicyWriteResult:
        """Lock `workflow_artifacts (project_id, id)`, compare, upsert. A PRIVATE policy
        also sets the artifact's channel agents inactive in the same transaction.
        Raises `SharedItemNotFound` (no artifact, or one that is no agent: none of
        its revisions carries `flags.is_agent`) and `SharingConflict`."""

    # -- sessions -----------------------------------------------------------------------

    @abstractmethod
    async def fetch_session_policy(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionPolicyState]:
        """Reads the row whatever `deleted_at` and `archived_at` hold. A legacy row
        (`visibility IS NULL`) first goes through `assign_legacy_session_access`. None
        only when no row exists."""

    async def fetch_session_policy_or_tombstone(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Tuple[Optional[SessionPolicyState], Optional[SessionTombstone]]:
        """`fetch_session_policy`, and the session's tombstone when it has no row, in
        the same read (the Postgres DAO reads both in one statement)."""
        state = await self.fetch_session_policy(
            project_id=project_id, session_id=session_id
        )
        return state, None

    @abstractmethod
    async def assign_legacy_session_access(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> None:
        """One guarded update with the backfill's owner rule. Idempotent."""

    @abstractmethod
    async def list_session_grants(
        self,
        *,
        project_id: UUID,
        stream_id: UUID,
    ) -> List[SessionGrant]: ...

    @abstractmethod
    async def list_user_grants(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> List[UserSessionGrant]: ...

    @abstractmethod
    async def set_session_sharing(
        self,
        *,
        project_id: UUID,
        session_id: str,
        #
        expected: AccessPolicy,
        change: SessionSharingChange,
        #
        user_id: UUID,
    ) -> SessionSharingWriteResult:
        """Lock the `session_streams` row, compare (visibility, owner) with `expected`,
        apply the delta in one transaction. Raises `SharedItemNotFound` and
        `SharingConflict`."""
