"""Approval choices: a person's "always approve" for one builder tool (design D32).

One row per person, project, agent and tool. The gate (`core/tools/gate.py`) reads it to
answer `allow` with the basis `approval_choice` in that person's own turns in a session
private to them.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from agenta.sdk.agents.tools.models import START_SESSION_CALL_REF

# The builder's `ask` tools, the only ones that accept a choice, by call ref.
APPROVAL_CHOICE_CALL_REFS = frozenset(
    {
        START_SESSION_CALL_REF,
        "tools.agenta.create_agent",
        "tools.agenta.edit_agent_config",
    }
)


class ApprovalChoice(BaseModel):
    id: UUID
    workflow_id: UUID
    tool_key: str
    created_at: Optional[datetime] = None


class ApprovalChoiceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: UUID
    # The tool's call ref, for example `tools.agenta.start_session`.
    tool_key: str


class ApprovalChoiceQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: Optional[UUID] = None
    tool_key: Optional[str] = None
