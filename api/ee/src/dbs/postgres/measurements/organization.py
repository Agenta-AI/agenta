"""Core-DB (`TransactionsEngine`) organization lookup for the measurement worker.

Deliberately narrow: reads only `ProjectDB.organization_id`. This is a project
lookup, not a wallet table, so it does not violate the worker's "no core wallet
table/DAO/service" boundary.
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import select

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.models.db_models import ProjectDB

from ee.src.core.measurements.interfaces import OrganizationResolverInterface


class ProjectOrganizationResolver(OrganizationResolverInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def resolve_organization_id(
        self,
        *,
        project_id: UUID,
    ) -> Optional[UUID]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(ProjectDB.organization_id).where(ProjectDB.id == project_id)
            )
            return result.scalar_one_or_none()
