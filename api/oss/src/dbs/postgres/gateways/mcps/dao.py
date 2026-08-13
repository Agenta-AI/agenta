from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified

from oss.src.core.gateways.mcps.dtos import (
    McpEndpoint,
    McpEndpointCreate,
    McpEndpointEdit,
    McpEndpointQuery,
    McpGrant,
    McpGrantCreate,
    McpGrantQuery,
)
from oss.src.core.gateways.mcps.interfaces import (
    McpEndpointsDAOInterface,
    McpGrantsDAOInterface,
)
from oss.src.core.shared.dtos import Status, Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.gateways.mcps.dbes import McpEndpointDBE, McpGrantDBE
from oss.src.dbs.postgres.gateways.mcps.mappings import (
    map_mcp_endpoint_create_to_dbe,
    map_mcp_endpoint_dbe_to_dto,
    map_mcp_endpoint_edit_to_dbe,
    map_mcp_grant_create_to_dbe,
    map_mcp_grant_dbe_to_dto,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.utils.exceptions import suppress_exceptions
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class McpEndpointsDAO(McpEndpointsDAOInterface):
    def __init__(
        self,
        *,
        McpEndpointDBE: type = McpEndpointDBE,
        engine: TransactionsEngine = None,
    ):
        self.McpEndpointDBE = McpEndpointDBE
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
        endpoint: McpEndpointCreate,
    ) -> Optional[McpEndpoint]:
        dbe = map_mcp_endpoint_create_to_dbe(
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

                return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

        except IntegrityError as e:
            error_str = str(e.orig) if e.orig else str(e)
            if "uq_mcp_gateway_endpoints_project_slug" in error_str:
                raise EntityCreationConflict(
                    entity="McpEndpoint",
                    message=f"MCP endpoint with slug '{endpoint.slug}' already exists.",
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
    ) -> Optional[McpEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.McpEndpointDBE)
                .filter(self.McpEndpointDBE.project_id == project_id)
                .filter(self.McpEndpointDBE.id == endpoint_id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None)
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[McpEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.McpEndpointDBE)
                .filter(self.McpEndpointDBE.project_id == project_id)
                .filter(self.McpEndpointDBE.slug == slug)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None)
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: McpEndpointEdit,
    ) -> Optional[McpEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.McpEndpointDBE)
                .filter(self.McpEndpointDBE.project_id == project_id)
                .filter(self.McpEndpointDBE.id == endpoint.id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            dbe = map_mcp_endpoint_edit_to_dbe(
                dbe=dbe,
                user_id=user_id,
                #
                dto=endpoint,
            )
            flag_modified(dbe, "data")
            flag_modified(dbe, "flags")

            await session.commit()
            await session.refresh(dbe)

            return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

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
                delete(self.McpEndpointDBE)
                .where(self.McpEndpointDBE.project_id == project_id)
                .where(self.McpEndpointDBE.id == endpoint_id)
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
        endpoint: Optional[McpEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[McpEndpoint]:
        async with self.engine.session() as session:
            stmt = select(self.McpEndpointDBE).filter(
                self.McpEndpointDBE.project_id == project_id,
            )

            if endpoint:
                if endpoint.auth_mode is not None:
                    stmt = stmt.filter(
                        self.McpEndpointDBE.auth_mode == endpoint.auth_mode
                    )

                if endpoint.slug is not None:
                    stmt = stmt.filter(self.McpEndpointDBE.slug == endpoint.slug)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=self.McpEndpointDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )
            else:
                stmt = stmt.order_by(self.McpEndpointDBE.created_at.desc())

            result = await session.execute(stmt)
            dbes = result.scalars().all()

            return [map_mcp_endpoint_dbe_to_dto(dbe=dbe) for dbe in dbes]


class McpGrantsDAO(McpGrantsDAOInterface):
    def __init__(
        self,
        *,
        McpGrantDBE: type = McpGrantDBE,
        engine: TransactionsEngine = None,
    ):
        self.McpGrantDBE = McpGrantDBE
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    @suppress_exceptions(default=None)
    async def create_grant(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        grant: McpGrantCreate,
    ) -> Optional[McpGrant]:
        """Never raises EntityCreationConflict: the two partial unique indexes
        (§2.5) are resolved here, not surfaced. `ON CONFLICT DO NOTHING ...
        RETURNING`, falling back to a fetch of the surviving row so a
        re-entered OAuth callback gets the existing grant rather than None."""
        dbe = map_mcp_grant_create_to_dbe(
            project_id=project_id,
            user_id=user_id,
            #
            dto=grant,
        )

        # Let column defaults (id, created_at, ...) fire at INSERT time rather
        # than pinning them to the unflushed Python-side None on this instance.
        values = {
            c.name: getattr(dbe, c.name)
            for c in self.McpGrantDBE.__table__.columns
            if not (
                c.name in ("id", "created_at", "updated_at", "deleted_at")
                and getattr(dbe, c.name) is None
            )
        }

        async with self.engine.session() as session:
            stmt = pg_insert(self.McpGrantDBE).values(**values)

            if grant.user_id is not None:
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=[
                        self.McpGrantDBE.project_id,
                        self.McpGrantDBE.endpoint_id,
                        self.McpGrantDBE.user_id,
                    ],
                    index_where=self.McpGrantDBE.user_id.isnot(None),
                )
            else:
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=[
                        self.McpGrantDBE.project_id,
                        self.McpGrantDBE.endpoint_id,
                    ],
                    index_where=self.McpGrantDBE.user_id.is_(None),
                )

            stmt = stmt.returning(self.McpGrantDBE)

            result = await session.execute(stmt)
            row = result.scalars().first()
            await session.commit()

            if row is not None:
                return map_mcp_grant_dbe_to_dto(dbe=row)

        return await self.fetch_grant(
            project_id=project_id,
            #
            endpoint_id=grant.endpoint_id,
            user_id=grant.user_id,
        )

    @suppress_exceptions(default=None)
    async def fetch_grant(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
        user_id: Optional[UUID],
    ) -> Optional[McpGrant]:
        async with self.engine.session() as session:
            stmt = (
                select(self.McpGrantDBE)
                .filter(self.McpGrantDBE.project_id == project_id)
                .filter(self.McpGrantDBE.endpoint_id == endpoint_id)
            )

            if user_id is None:
                stmt = stmt.filter(self.McpGrantDBE.user_id.is_(None))
            else:
                stmt = stmt.filter(self.McpGrantDBE.user_id == user_id)

            stmt = stmt.limit(1)

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_mcp_grant_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None)
    async def fetch_grant_by_id(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> Optional[McpGrant]:
        async with self.engine.session() as session:
            stmt = (
                select(self.McpGrantDBE)
                .filter(self.McpGrantDBE.project_id == project_id)
                .filter(self.McpGrantDBE.id == grant_id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_mcp_grant_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None)
    async def update_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
        is_valid: Optional[bool] = None,
        status: Optional[Status] = None,
    ) -> Optional[McpGrant]:
        """Server-set operational state only (§2.6): flip is_valid, record the
        refresh outcome. Never touches endpoint_id, user_id or secret_id."""
        async with self.engine.session() as session:
            stmt = (
                select(self.McpGrantDBE)
                .filter(self.McpGrantDBE.project_id == project_id)
                .filter(self.McpGrantDBE.id == grant_id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            if is_valid is not None:
                flags = {**(dbe.flags or {})}
                flags["is_valid"] = is_valid
                dbe.flags = flags
                flag_modified(dbe, "flags")

            if status is not None:
                dbe.status = status.model_dump(mode="json")
                flag_modified(dbe, "status")

            dbe.updated_at = datetime.now(timezone.utc)

            await session.commit()
            await session.refresh(dbe)

            return map_mcp_grant_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=False)
    async def delete_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = (
                delete(self.McpGrantDBE)
                .where(self.McpGrantDBE.project_id == project_id)
                .where(self.McpGrantDBE.id == grant_id)
            )

            result = await session.execute(stmt)
            await session.commit()

            return result.rowcount > 0

    @suppress_exceptions(default=[])
    async def query_grants(
        self,
        *,
        project_id: UUID,
        #
        grant: Optional[McpGrantQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[McpGrant]:
        async with self.engine.session() as session:
            stmt = select(self.McpGrantDBE).filter(
                self.McpGrantDBE.project_id == project_id,
            )

            if grant:
                if grant.endpoint_id is not None:
                    stmt = stmt.filter(
                        self.McpGrantDBE.endpoint_id == grant.endpoint_id
                    )

                if grant.user_id is not None:
                    stmt = stmt.filter(self.McpGrantDBE.user_id == grant.user_id)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=self.McpGrantDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )
            else:
                stmt = stmt.order_by(self.McpGrantDBE.created_at.desc())

            result = await session.execute(stmt)
            dbes = result.scalars().all()

            return [map_mcp_grant_dbe_to_dto(dbe=dbe) for dbe in dbes]
