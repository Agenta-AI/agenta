from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.approval_choices.dtos import (
    ApprovalChoice,
    ApprovalChoiceCreate,
    ApprovalChoiceQuery,
)
from oss.src.core.approval_choices.interfaces import ApprovalChoicesDAOInterface
from oss.src.dbs.postgres.approval_choices.dbes import ApprovalChoiceDBE
from oss.src.dbs.postgres.approval_choices.mappings import (
    map_approval_choice_dbe_to_dto,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)


class ApprovalChoicesDAO(ApprovalChoicesDAOInterface):
    def __init__(self, engine: Optional[TransactionsEngine] = None):
        self.engine = engine or get_transactions_engine()

    @staticmethod
    def _mine(*, project_id: UUID, user_id: UUID) -> tuple:
        return (
            ApprovalChoiceDBE.project_id == project_id,
            ApprovalChoiceDBE.user_id == user_id,
        )

    async def create(
        self, *, project_id: UUID, user_id: UUID, choice: ApprovalChoiceCreate
    ) -> ApprovalChoice:
        stmt = (
            insert(ApprovalChoiceDBE)
            .values(
                project_id=project_id,
                artifact_id=choice.workflow_id,
                user_id=user_id,
                tool_key=choice.tool_key,
                created_by_id=user_id,
            )
            .on_conflict_do_nothing(
                constraint="uq_approval_choices_project_id_artifact_id_user_id_tool_key"
            )
        )
        async with self.engine.session() as session:
            await session.execute(stmt)
            await session.commit()
        stored = await self.fetch_by_tool(
            project_id=project_id,
            user_id=user_id,
            artifact_id=choice.workflow_id,
            tool_key=choice.tool_key,
        )
        if stored is None:
            raise RuntimeError("The approval choice was not stored.")
        return stored

    async def query(
        self, *, project_id: UUID, user_id: UUID, query: ApprovalChoiceQuery
    ) -> List[ApprovalChoice]:
        stmt = select(ApprovalChoiceDBE).where(
            *self._mine(project_id=project_id, user_id=user_id)
        )
        if query.workflow_id is not None:
            stmt = stmt.where(ApprovalChoiceDBE.artifact_id == query.workflow_id)
        if query.tool_key is not None:
            stmt = stmt.where(ApprovalChoiceDBE.tool_key == query.tool_key)
        async with self.engine.session() as session:
            result = await session.execute(stmt.order_by(ApprovalChoiceDBE.id))
            return [map_approval_choice_dbe_to_dto(dbe) for dbe in result.scalars()]

    async def delete(
        self, *, project_id: UUID, user_id: UUID, approval_choice_id: UUID
    ) -> bool:
        async with self.engine.session() as session:
            result = await session.execute(
                delete(ApprovalChoiceDBE).where(
                    *self._mine(project_id=project_id, user_id=user_id),
                    ApprovalChoiceDBE.id == approval_choice_id,
                )
            )
            await session.commit()
            return (result.rowcount or 0) > 0

    async def fetch_by_tool(
        self, *, project_id: UUID, user_id: UUID, artifact_id: UUID, tool_key: str
    ) -> Optional[ApprovalChoice]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(ApprovalChoiceDBE).where(
                    *self._mine(project_id=project_id, user_id=user_id),
                    ApprovalChoiceDBE.artifact_id == artifact_id,
                    ApprovalChoiceDBE.tool_key == tool_key,
                )
            )
            dbe = result.scalars().first()
            return map_approval_choice_dbe_to_dto(dbe) if dbe else None
