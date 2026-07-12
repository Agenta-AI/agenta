from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import Lifecycle


class SessionStateFlags(BaseModel):
    pass


class HarnessSessionRecord(BaseModel):
    """Per-harness resume state. Value shape of `data.harness_sessions[<harness>]`."""

    agent_session_id: Optional[str] = Field(
        default=None,
        description="This harness's own agentSessionId, fed to session/load on resume.",
    )
    turn_index: Optional[int] = Field(
        default=None,
        description=(
            "Conversation turn number this harness last ran at. Load-eligible only "
            "when equal to the conversation's latest_turn_index; otherwise this "
            "harness's session file is stale (another harness ran since)."
        ),
    )


class SessionStateData(BaseModel):
    """Typed shape of the `data` column: the session's durable continuity state.

    Stored in the existing `data` JSON column (no dedicated columns) — every field is
    read and compared in the runner, never queried server-side, so a typed DTO gives the
    contract without a schema change.
    """

    latest_agent_session_id: Optional[str] = Field(
        default=None,
        description=(
            "The latest-run harness's agentSessionId; a fast-path mirror of "
            "harness_sessions[<latest harness>].agent_session_id."
        ),
    )
    latest_turn_index: Optional[int] = Field(
        default=None,
        description="Conversation-level turn counter compared against each harness's "
        "turn_index.",
    )
    harness_sessions: Optional[Dict[str, HarnessSessionRecord]] = Field(
        default=None,
        description=(
            "Per-harness resume state, keyed by harness id (e.g. 'claude', 'pi'). "
            "Durable mirror of the staleness guard."
        ),
    )


class SessionState(Lifecycle):
    id: Optional[UUID] = Field(default=None, description="Own uuid7 pk (state_id).")
    project_id: Optional[UUID] = Field(default=None)
    session_id: str = Field(description="Bare session correlator (not an FK).")
    data: Optional[SessionStateData] = Field(
        default=None,
        description="Durable continuity state (resume ids + staleness guard).",
    )
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id — the single source of truth resume pointer.",
    )
    flags: SessionStateFlags = Field(default_factory=SessionStateFlags)
    tags: Optional[Dict[str, Any]] = Field(default=None)
    meta: Optional[Dict[str, Any]] = Field(default=None)


class SessionStateUpsert(BaseModel):
    data: Optional[SessionStateData] = Field(
        default=None,
        description=(
            "Full replacement of the continuity state. Callers read-modify-write: "
            "GET the current row, patch the one harness's entry, PUT the whole data back."
        ),
    )
    sandbox_id: Optional[str] = Field(
        default=None,
        description="Remote sandbox id to record alongside the continuity state.",
    )
    sandbox_turn_index: Optional[int] = Field(
        default=None,
        description=(
            "the writer's conversation turn index; the pointer write is applied only "
            "when it is >= the row's data.latest_turn_index."
        ),
    )
