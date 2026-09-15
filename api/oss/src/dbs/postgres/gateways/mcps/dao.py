from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified

from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointEdit,
    MCPEndpointQuery,
)
from oss.src.core.gateways.mcps.interfaces import (
    MCPEndpointsDAOInterface,
)
from oss.src.core.shared.dtos import Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.gateways.mcps.dbes import MCPEndpointDBE
from oss.src.core.gateways.policy.types import SecretInvalidError
from oss.src.dbs.postgres.gateways.tenancy import check_secret_is_owned_by_project
from oss.src.dbs.postgres.gateways.mcps.mappings import (
    map_mcp_endpoint_create_to_dbe,
    map_mcp_endpoint_dbe_to_dto,
    map_mcp_endpoint_edit_to_dbe,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.utils.exceptions import suppress_exceptions
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class MCPEndpointsDAO(MCPEndpointsDAOInterface):
    def __init__(
        self,
        *,
        MCPEndpointDBE: type = MCPEndpointDBE,
        engine: TransactionsEngine = None,
    ):
        self.MCPEndpointDBE = MCPEndpointDBE
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    # `IntegrityError` is excluded because a write the database refused must not be
    # reported as a create that produced nothing. A missing slug raised a not-null
    # violation here, the decorator swallowed it, the DAO returned `None`, and the route
    # answered `200 {"count": 0}` — a success that created no record, which is worse to
    # debug than a refusal. The slug-unique case is still converted below into the
    # `EntityCreationConflict` callers expect; everything else now reaches the caller.
    @suppress_exceptions(
        exclude=[EntityCreationConflict, SecretInvalidError, IntegrityError]
    )
    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointCreate,
    ) -> Optional[MCPEndpoint]:
        dbe = map_mcp_endpoint_create_to_dbe(
            project_id=project_id,
            user_id=user_id,
            #
            dto=endpoint,
        )

        try:
            async with self.engine.session() as session:
                await check_secret_is_owned_by_project(
                    session,
                    project_id=project_id,
                    bound_secret=dbe.secret_id,
                    target=f"custom/{dbe.slug}",
                )

                session.add(dbe)
                await session.commit()
                await session.refresh(dbe)

                return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

        except IntegrityError as e:
            error_str = str(e.orig) if e.orig else str(e)
            if "uq_mcps_endpoints_project_slug" in error_str:
                raise EntityCreationConflict(
                    entity="MCPEndpoint",
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
    ) -> Optional[MCPEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.MCPEndpointDBE)
                .filter(self.MCPEndpointDBE.project_id == project_id)
                .filter(self.MCPEndpointDBE.id == endpoint_id)
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
    ) -> Optional[MCPEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.MCPEndpointDBE)
                .filter(self.MCPEndpointDBE.project_id == project_id)
                .filter(self.MCPEndpointDBE.slug == slug)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None, exclude=[SecretInvalidError])
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointEdit,
    ) -> Optional[MCPEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.MCPEndpointDBE)
                .filter(self.MCPEndpointDBE.project_id == project_id)
                .filter(self.MCPEndpointDBE.id == endpoint.id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            # Before the mapping, not after: this edit is a full PUT that assigns the
            # row's credential from the payload, and a query issued against a session
            # holding a modified row would autoflush that row on its way out.
            await check_secret_is_owned_by_project(
                session,
                project_id=project_id,
                bound_secret=endpoint.secret_id,
                target=f"custom/{dbe.slug}",
            )

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

    # Excluded for the same reason `edit_endpoint` excludes it: this write refuses a
    # credential the project does not own, and a swallowed refusal returns `None`, which
    # the connect route reported as `count=1` with no endpoint. A success that did
    # nothing is worse to debug than a refusal, which is the reading recorded above for
    # `create_endpoint` (D20). Nothing cross-tenant is written either way — the exception
    # aborts the transaction before the commit — so what this restores is the typed
    # refusal, not the isolation.
    @suppress_exceptions(default=None, exclude=[SecretInvalidError])
    async def bind_endpoint_secret(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint_id: UUID,
        secret_id: Optional[UUID],
    ) -> Optional[MCPEndpoint]:
        async with self.engine.session() as session:
            dbe = await self._locked(
                session, project_id=project_id, endpoint_id=endpoint_id
            )
            if dbe is None:
                return None

            await check_secret_is_owned_by_project(
                session,
                project_id=project_id,
                bound_secret=secret_id,
                target=f"custom/{dbe.slug}",
            )

            dbe.secret_id = secret_id
            # A connection holding a fresh grant is valid again. The data plane marks one
            # invalid when its authorization dies (OR55) and reconnecting is the cure, so
            # carrying that flag forward would leave a reconnected connection refusing
            # calls it can now serve.
            self._set_is_valid(dbe, True)
            self._stamp(dbe, user_id)

            await session.commit()
            await session.refresh(dbe)

            return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

    @suppress_exceptions()
    async def invalidate_endpoint_secret(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint_id: UUID,
        secret_id: Optional[UUID],
    ) -> Optional[MCPEndpoint]:
        async with self.engine.session() as session:
            dbe = await self._locked(
                session, project_id=project_id, endpoint_id=endpoint_id
            )
            if dbe is None:
                return None

            # Conditional on the handle the caller was actually using, compared inside
            # the transaction and never written back. The relay decides this after a
            # round trip, so what it holds is the connection as it was before the call
            # went out; if a reconnect landed meanwhile, the credential that failed is
            # not the credential the connection holds now, and marking it invalid would
            # report a freshly repaired connection as needing another reconnect (D21).
            #
            # `None` means the handle went entirely, which is the disconnect case and
            # equally not this caller's to invalidate.
            if dbe.secret_id is None or dbe.secret_id != secret_id:
                return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

            self._set_is_valid(dbe, False)
            self._stamp(dbe, user_id)

            await session.commit()
            await session.refresh(dbe)

            return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

    async def _locked(self, session, *, project_id: UUID, endpoint_id: UUID):
        """The row, locked for the rest of the transaction.

        `FOR UPDATE` because these two writes are read-modify-write on one JSON column:
        two of them landing together would otherwise each write the flags they read.
        """
        stmt = (
            select(self.MCPEndpointDBE)
            .filter(self.MCPEndpointDBE.project_id == project_id)
            .filter(self.MCPEndpointDBE.id == endpoint_id)
            .limit(1)
            .with_for_update()
        )
        result = await session.execute(stmt)
        return result.scalars().first()

    @staticmethod
    def _set_is_valid(dbe, is_valid: bool) -> None:
        """Rewrite one key of the stored flags, keeping every other key it holds."""
        flags = dict(dbe.flags or {})
        flags["is_valid"] = is_valid
        dbe.flags = flags
        flag_modified(dbe, "flags")

    @staticmethod
    def _stamp(dbe, user_id: UUID) -> None:
        dbe.updated_at = datetime.now(timezone.utc)
        dbe.updated_by_id = user_id

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
                delete(self.MCPEndpointDBE)
                .where(self.MCPEndpointDBE.project_id == project_id)
                .where(self.MCPEndpointDBE.id == endpoint_id)
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
        endpoint: Optional[MCPEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[MCPEndpoint]:
        async with self.engine.session() as session:
            stmt = select(self.MCPEndpointDBE).filter(
                self.MCPEndpointDBE.project_id == project_id,
            )

            if endpoint:
                if endpoint.auth_mode is not None:
                    stmt = stmt.filter(
                        self.MCPEndpointDBE.auth_mode == endpoint.auth_mode
                    )

                if endpoint.slug is not None:
                    stmt = stmt.filter(self.MCPEndpointDBE.slug == endpoint.slug)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=self.MCPEndpointDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )
            else:
                stmt = stmt.order_by(self.MCPEndpointDBE.created_at.desc())

            result = await session.execute(stmt)
            dbes = result.scalars().all()

            return [map_mcp_endpoint_dbe_to_dto(dbe=dbe) for dbe in dbes]
