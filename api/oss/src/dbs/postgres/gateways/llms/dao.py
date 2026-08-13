from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified

from oss.src.core.gateways.llms.dtos import (
    LlmEndpoint,
    LlmEndpointCreate,
    LlmEndpointEdit,
    LlmEndpointQuery,
)
from oss.src.core.gateways.llms.interfaces import LlmEndpointsDAOInterface
from oss.src.core.shared.dtos import Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.gateways.llms.dbes import LlmEndpointDBE
from oss.src.dbs.postgres.gateways.llms.mappings import (
    map_llm_endpoint_create_to_dbe,
    map_llm_endpoint_dbe_to_dto,
    map_llm_endpoint_edit_to_dbe,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.utils.exceptions import suppress_exceptions
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class LlmEndpointsDAO(LlmEndpointsDAOInterface):
    def __init__(
        self,
        *,
        LlmEndpointDBE: type = LlmEndpointDBE,
        engine: TransactionsEngine = None,
    ):
        self.LlmEndpointDBE = LlmEndpointDBE
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LlmEndpointCreate,
    ) -> Optional[LlmEndpoint]:
        dbe = map_llm_endpoint_create_to_dbe(
            project_id=project_id,
            user_id=user_id,
            #
            dto=endpoint,
        )

        try:
            async with self.engine.session() as session:
                session.add(dbe)
                await session.commit()
                await session.refresh(dbe)

                return map_llm_endpoint_dbe_to_dto(dbe=dbe)

        except IntegrityError as e:
            error_str = str(e.orig) if e.orig else str(e)
            if "uq_llm_gateway_endpoints_project_slug" in error_str:
                raise EntityCreationConflict(
                    entity="LlmEndpoint",
                    message=f"LLM endpoint with slug '{endpoint.slug}' already exists.",
                    conflict={"slug": endpoint.slug},
                ) from e
            raise

    @suppress_exceptions(default=None)
    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[LlmEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.LlmEndpointDBE)
                .filter(self.LlmEndpointDBE.project_id == project_id)
                .filter(self.LlmEndpointDBE.id == endpoint_id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_llm_endpoint_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None)
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[LlmEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.LlmEndpointDBE)
                .filter(self.LlmEndpointDBE.project_id == project_id)
                .filter(self.LlmEndpointDBE.slug == slug)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_llm_endpoint_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None)
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LlmEndpointEdit,
    ) -> Optional[LlmEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.LlmEndpointDBE)
                .filter(self.LlmEndpointDBE.project_id == project_id)
                .filter(self.LlmEndpointDBE.id == endpoint.id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            dbe = map_llm_endpoint_edit_to_dbe(
                dbe=dbe,
                user_id=user_id,
                #
                dto=endpoint,
            )
            flag_modified(dbe, "data")
            flag_modified(dbe, "flags")

            await session.commit()
            await session.refresh(dbe)

            return map_llm_endpoint_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=False)
    async def delete_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = (
                delete(self.LlmEndpointDBE)
                .where(self.LlmEndpointDBE.project_id == project_id)
                .where(self.LlmEndpointDBE.id == endpoint_id)
            )

            result = await session.execute(stmt)
            await session.commit()

            return result.rowcount > 0

    @suppress_exceptions(default=[])
    async def query_endpoints(
        self,
        *,
        project_id: UUID,
        #
        endpoint: Optional[LlmEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[LlmEndpoint]:
        async with self.engine.session() as session:
            stmt = select(self.LlmEndpointDBE).filter(
                self.LlmEndpointDBE.project_id == project_id,
            )

            if endpoint:
                if endpoint.provider_key is not None:
                    stmt = stmt.filter(
                        self.LlmEndpointDBE.provider_key == endpoint.provider_key
                    )

                if endpoint.deployment is not None:
                    stmt = stmt.filter(
                        self.LlmEndpointDBE.deployment == endpoint.deployment
                    )

                if endpoint.slug is not None:
                    stmt = stmt.filter(self.LlmEndpointDBE.slug == endpoint.slug)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=self.LlmEndpointDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )
            else:
                stmt = stmt.order_by(self.LlmEndpointDBE.created_at.desc())

            result = await session.execute(stmt)
            dbes = result.scalars().all()

            return [map_llm_endpoint_dbe_to_dto(dbe=dbe) for dbe in dbes]
