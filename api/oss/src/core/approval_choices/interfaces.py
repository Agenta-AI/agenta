from typing import List, Optional
from uuid import UUID

from oss.src.core.approval_choices.dtos import (
    ApprovalChoice,
    ApprovalChoiceCreate,
    ApprovalChoiceQuery,
)


class ApprovalChoicesDAOInterface:
    """Storage of `approval_choices`. Every read and write names the project and the
    person, so a person only ever reaches their own choices."""

    async def create(
        self, *, project_id: UUID, user_id: UUID, choice: ApprovalChoiceCreate
    ) -> ApprovalChoice:
        """Store the choice; the same choice again returns the stored row."""
        raise NotImplementedError

    async def query(
        self, *, project_id: UUID, user_id: UUID, query: ApprovalChoiceQuery
    ) -> List[ApprovalChoice]:
        raise NotImplementedError

    async def delete(
        self, *, project_id: UUID, user_id: UUID, approval_choice_id: UUID
    ) -> bool:
        raise NotImplementedError

    async def fetch_by_tool(
        self, *, project_id: UUID, user_id: UUID, artifact_id: UUID, tool_key: str
    ) -> Optional[ApprovalChoice]:
        raise NotImplementedError
