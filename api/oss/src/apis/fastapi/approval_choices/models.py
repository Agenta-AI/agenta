from typing import List, Optional

from pydantic import BaseModel, ConfigDict

from oss.src.core.approval_choices.dtos import (
    ApprovalChoice,
    ApprovalChoiceCreate,
    ApprovalChoiceQuery,
)


class ApprovalChoiceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approval_choice: ApprovalChoiceCreate


class ApprovalChoiceResponse(BaseModel):
    count: int = 0
    approval_choice: Optional[ApprovalChoice] = None


class ApprovalChoiceQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approval_choice: Optional[ApprovalChoiceQuery] = None


class ApprovalChoicesResponse(BaseModel):
    count: int = 0
    approval_choices: List[ApprovalChoice] = []
