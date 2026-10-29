"""Account choices: which of a person's accounts fills a "user" item of an agent.

An account choice is a stored row: for this person, this agent and this item, use this
account. `ItemAccount` is the resolved view of one item for one person, from a choice, a
default or a sign-in. `RunAccount` is one entry of the run credential's `run_accounts`
claim.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# The text of a "user" item key: `<kind>:user/<match text>`. The SDK builds it
# (`agenta.sdk.agents.accounts.user_item_key`); this pattern only checks its shape.
ITEM_KEY_PATTERN = r"^(app_connection|mcp_server|secret|subscription):user/\S+$"


class AccountMatch(str, Enum):
    CHOICE = "choice"
    DEFAULT = "default"
    SIGN_IN = "sign_in"


def _one_account(secret_id: Optional[UUID], gateway_connection_id: Optional[UUID]):
    if (secret_id is None) == (gateway_connection_id is None):
        raise ValueError("name exactly one of secret_id and gateway_connection_id")


class AccountChoice(BaseModel):
    id: UUID
    workflow_id: UUID
    item_key: str
    secret_id: Optional[UUID] = None
    gateway_connection_id: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AccountChoiceUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: UUID
    item_key: str = Field(pattern=ITEM_KEY_PATTERN)
    secret_id: Optional[UUID] = None
    gateway_connection_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _exactly_one_account(self) -> "AccountChoiceUpsert":
        _one_account(self.secret_id, self.gateway_connection_id)
        return self


class AccountChoiceQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: Optional[UUID] = None
    item_key: Optional[str] = Field(default=None, pattern=ITEM_KEY_PATTERN)
    secret_ids: Optional[List[UUID]] = None
    gateway_connection_ids: Optional[List[UUID]] = None


class ItemAccount(BaseModel):
    """One "user" item of an agent, resolved for one person."""

    item_key: str
    match: Optional[AccountMatch] = None  # None: no account matched
    secret_id: Optional[UUID] = None
    gateway_connection_id: Optional[UUID] = None
    name: Optional[str] = None  # the account's name, for the interface
    is_ready: bool = False
    candidates: int = 0  # the person's accounts that fit the item


class RunAccount(BaseModel):
    """One entry of the `run_accounts` claim: the ready account of one "user" item."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    item_key: str = Field(pattern=ITEM_KEY_PATTERN)
    secret_id: Optional[UUID] = None
    gateway_connection_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _exactly_one_account(self) -> "RunAccount":
        _one_account(self.secret_id, self.gateway_connection_id)
        return self


class ChoiceAccount(BaseModel):
    """The account an upsert names, read only when the person owns it in the agent's
    organization: what the upsert checks against the item."""

    secret_kind: Optional[str] = None  # the stored kind name, e.g. `CUSTOM_SECRET`
    provider_key: Optional[str] = None
    integration_key: Optional[str] = None
