from typing import List
from uuid import UUID

from oss.src.core.approval_choices.dtos import (
    APPROVAL_CHOICE_CALL_REFS,
    ApprovalChoice,
    ApprovalChoiceCreate,
    ApprovalChoiceQuery,
)
from oss.src.core.approval_choices.exceptions import ApprovalChoiceNotSupported
from oss.src.core.approval_choices.interfaces import ApprovalChoicesDAOInterface


class ApprovalChoicesService:
    def __init__(self, *, approval_choices_dao: ApprovalChoicesDAOInterface):
        self.approval_choices_dao = approval_choices_dao

    async def create(
        self, *, project_id: UUID, user_id: UUID, choice: ApprovalChoiceCreate
    ) -> ApprovalChoice:
        if choice.call_ref not in APPROVAL_CHOICE_CALL_REFS:
            raise ApprovalChoiceNotSupported()
        return await self.approval_choices_dao.create(
            project_id=project_id, user_id=user_id, choice=choice
        )

    async def query(
        self, *, project_id: UUID, user_id: UUID, query: ApprovalChoiceQuery
    ) -> List[ApprovalChoice]:
        return await self.approval_choices_dao.query(
            project_id=project_id, user_id=user_id, query=query
        )

    async def delete(
        self, *, project_id: UUID, user_id: UUID, approval_choice_id: UUID
    ) -> bool:
        return await self.approval_choices_dao.delete(
            project_id=project_id,
            user_id=user_id,
            approval_choice_id=approval_choice_id,
        )
