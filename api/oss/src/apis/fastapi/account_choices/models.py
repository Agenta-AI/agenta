from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator

from oss.src.core.account_choices.dtos import (
    AccountChoice,
    AccountChoiceQuery,
    AccountChoiceUpsert,
    ItemAccount,
)
from oss.src.core.shared.dtos import Reference, Windowing


class AccountChoiceUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_choice: AccountChoiceUpsert


class AccountChoiceResponse(BaseModel):
    count: int = 0
    account_choice: Optional[AccountChoice] = None


class AccountChoiceQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_choice: Optional[AccountChoiceQuery] = None
    windowing: Optional[Windowing] = None


class AccountChoicesResponse(BaseModel):
    count: int = 0
    account_choices: List[AccountChoice] = []
    windowing: Optional[Windowing] = None


class AccountChoicesResolveRequest(BaseModel):
    """The agent, and either a saved revision of it or a draft configuration (an unsaved
    item in the editor): exactly one, as on the Needs setup route."""

    model_config = ConfigDict(extra="forbid")

    workflow_id: UUID
    workflow_revision_ref: Optional[Reference] = None
    parameters: Optional[dict] = None

    @model_validator(mode="after")
    def _one_source(self) -> "AccountChoicesResolveRequest":
        if (self.workflow_revision_ref is None) == (self.parameters is None):
            raise ValueError("send exactly one of workflow_revision_ref and parameters")
        return self


class ItemAccountsResponse(BaseModel):
    count: int = 0
    item_accounts: List[ItemAccount] = []
