from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified

from oss.src.core.gateways.llms.dtos import (
    LLMEndpoint,
    LLMEndpointCreate,
    LLMEndpointEdit,
    LLMEndpointQuery,
)
from oss.src.core.gateways.llms.interfaces import LLMEndpointsDAOInterface
from oss.src.core.shared.dtos import Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.gateways.llms.dbes import LLMEndpointDBE
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


class LLMEndpointsDAO(LLMEndpointsDAOInterface):
    def __init__(
        self,
        *,
        LLMEndpointDBE: type = LLMEndpointDBE,
        engine: TransactionsEngine = None,
    ):
        self.LLMEndpointDBE = LLMEndpointDBE
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
        endpoint: LLMEndpointCreate,
    ) -> Optional[LLMEndpoint]:
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
            if "uq_llms_endpoints_project_slug" in error_str:
                raise EntityCreationConflict(
                    entity="LLMEndpoint",
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
    ) -> Optional[LLMEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.LLMEndpointDBE)
                .filter(self.LLMEndpointDBE.project_id == project_id)
                .filter(self.LLMEndpointDBE.id == endpoint_id)
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
    ) -> Optional[LLMEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.LLMEndpointDBE)
                .filter(self.LLMEndpointDBE.project_id == project_id)
                .filter(self.LLMEndpointDBE.slug == slug)
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
        endpoint: LLMEndpointEdit,
    ) -> Optional[LLMEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.LLMEndpointDBE)
                .filter(self.LLMEndpointDBE.project_id == project_id)
                .filter(self.LLMEndpointDBE.id == endpoint.id)
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
                delete(self.LLMEndpointDBE)
                .where(self.LLMEndpointDBE.project_id == project_id)
                .where(self.LLMEndpointDBE.id == endpoint_id)
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
        endpoint: Optional[LLMEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[LLMEndpoint]:
        async with self.engine.session() as session:
            stmt = select(self.LLMEndpointDBE).filter(
                self.LLMEndpointDBE.project_id == project_id,
            )

            if endpoint:
                if endpoint.provider_key is not None:
                    stmt = stmt.filter(
                        self.LLMEndpointDBE.provider_key == endpoint.provider_key
                    )

                if endpoint.deployment_kind is not None:
                    stmt = stmt.filter(
                        self.LLMEndpointDBE.deployment_kind == endpoint.deployment_kind
                    )

                if endpoint.slug is not None:
                    stmt = stmt.filter(self.LLMEndpointDBE.slug == endpoint.slug)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=self.LLMEndpointDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )
            else:
                stmt = stmt.order_by(self.LLMEndpointDBE.created_at.desc())

            result = await session.execute(stmt)
            dbes = result.scalars().all()

            return [map_llm_endpoint_dbe_to_dto(dbe=dbe) for dbe in dbes]
