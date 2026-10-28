from typing import List
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.credentials.uses import CredentialUse, CredentialUsesDAOInterface
from oss.src.dbs.postgres.credentials.dbes import RunCredentialUseDBE
from oss.src.dbs.postgres.shared.engine import TransactionsEngine


class CredentialUsesDAO(CredentialUsesDAOInterface):
    def __init__(self, *, engine: TransactionsEngine) -> None:
        self.engine = engine

    async def record_use(self, *, project_id: UUID, use: CredentialUse) -> None:
        values = use.model_dump(exclude={"created_at"})
        async with self.engine.session() as session:
            await session.execute(
                insert(RunCredentialUseDBE)
                .values(project_id=project_id, **values)
                .on_conflict_do_nothing(constraint="pk_run_credential_uses")
            )
            await session.commit()

    async def list_for_session(
        self, *, project_id: UUID, session_id: str
    ) -> List[CredentialUse]:
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    select(RunCredentialUseDBE)
                    .where(
                        RunCredentialUseDBE.project_id == project_id,
                        RunCredentialUseDBE.session_id == session_id,
                    )
                    .order_by(RunCredentialUseDBE.created_at)
                )
            ).scalars()
            return [
                CredentialUse(
                    session_id=row.session_id,
                    run_id=row.run_id,
                    connection_key=row.connection_key,
                    binding=row.binding,
                    owner_kind=row.owner_kind,
                    owner_id=row.owner_id,
                    credential_id=row.credential_id,
                    credential_name=row.credential_name,
                    created_at=row.created_at,
                )
                for row in rows
            ]
