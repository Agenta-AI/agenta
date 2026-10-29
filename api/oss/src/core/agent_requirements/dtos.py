"""The requirements of an agent: the items it names that need setup where it runs."""

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class AgentRequirementKind(str, Enum):
    MODEL_KEY = "model_key"
    SUBSCRIPTION = "subscription"
    MODEL = "model"
    MCP_SERVER = "mcp_server"
    MCP_SIGN_IN = "mcp_sign_in"
    SECRET = "secret"
    APP_CONNECTION = "app_connection"


class AgentRequirementReason(str, Enum):
    NOT_CHOSEN = "not_chosen"
    NOT_FOUND = "not_found"
    NOT_SHARED = "not_shared"
    TURNED_OFF = "turned_off"
    NEEDS_SIGN_IN = "needs_sign_in"
    NOT_AVAILABLE = "not_available"


class AgentRequirementsStatus(str, Enum):
    READY = "ready"
    NEEDS_SETUP = "needs_setup"


class AgentRequirementAsk(BaseModel):
    """Who can act when the caller cannot."""

    role: str


class AgentRequirementFix(BaseModel):
    """What the caller can do about one requirement."""

    can_edit_agent: bool = False
    can_connect: bool = False
    can_sign_in: bool = False
    candidates: int = 0
    ask: Optional[AgentRequirementAsk] = None


class AgentRequirementDetail(BaseModel):
    """The code the run failed with before this change, kept for logs and tests."""

    code: str


class AgentRequirement(BaseModel):
    key: str
    kind: AgentRequirementKind
    label: str
    reference: Dict[str, Any]
    paths: List[str]
    reason: AgentRequirementReason
    blocks_run: bool
    fix: Optional[AgentRequirementFix] = None
    detail: Optional[AgentRequirementDetail] = None


class AgentRequirements(BaseModel):
    count: int = 0
    status: AgentRequirementsStatus = AgentRequirementsStatus.READY
    requirements: List[AgentRequirement] = []

    @classmethod
    def of(cls, requirements: List[AgentRequirement]) -> "AgentRequirements":
        return cls(
            count=len(requirements),
            status=(
                AgentRequirementsStatus.NEEDS_SETUP
                if requirements
                else AgentRequirementsStatus.READY
            ),
            requirements=requirements,
        )
