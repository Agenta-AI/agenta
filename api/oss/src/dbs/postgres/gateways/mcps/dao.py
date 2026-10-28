from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm.attributes import flag_modified

from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpointCheck,
    MCPOAuthData,
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointEdit,
    MCPEndpointQuery,
    is_oauth_connection_at,
)
from oss.src.core.gateways.mcps.interfaces import (
    MCPEndpointsDAOInterface,
)
from oss.src.core.gateways.mcps.types import MCPConnectionBusyError
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
from oss.src.dbs.postgres.shared.exceptions import is_lock_timeout
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.utils.exceptions import suppress_exceptions
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# How long a change waits for a connection's OAuth lock. Each waiter holds a pooled
# connection while it waits, so an unbounded wait behind a stuck holder can drain the pool.
_OAUTH_LOCK_TIMEOUT = "30s"


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
        owner: Optional[SecretOwner] = None,
    ) -> Optional[MCPEndpoint]:
        """With a user `owner` (M7) the row is that person's own server, with no
        project; it binds no secret."""
        dbe = map_mcp_endpoint_create_to_dbe(
            project_id=project_id,
            user_id=user_id,
            #
            dto=endpoint,
            owner=owner,
        )

        try:
            async with self.engine.session() as session:
                if owner is None:
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
            if (
                "uq_mcps_endpoints_project_slug" in error_str
                or "uq_mcps_endpoints_user_slug" in error_str
            ):
                raise EntityCreationConflict(
                    entity="MCPEndpoint",
                    message=f"MCP endpoint with slug '{endpoint.slug}' already exists.",
                    conflict={"slug": endpoint.slug},
                ) from e
            raise

    # -- a person's own servers (M7): always by the full owner; a project read never
    # sees these rows, and these reads never see project rows.

    def _owned(self, owner: SecretOwner):
        return (
            self.MCPEndpointDBE.organization_id == owner.organization_id,
            self.MCPEndpointDBE.user_id == owner.id,
        )

    async def query_owned_endpoints(self, *, owner: SecretOwner) -> List[MCPEndpoint]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(self.MCPEndpointDBE)
                .filter(*self._owned(owner))
                .order_by(self.MCPEndpointDBE.created_at.desc())
            )
            return [map_mcp_endpoint_dbe_to_dto(dbe=dbe) for dbe in result.scalars()]

    async def fetch_owned_endpoint_by_slug(
        self, *, owner: SecretOwner, slug: str
    ) -> Optional[MCPEndpoint]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(self.MCPEndpointDBE)
                .filter(*self._owned(owner), self.MCPEndpointDBE.slug == slug)
                .limit(1)
            )
            dbe = result.scalars().first()
            return map_mcp_endpoint_dbe_to_dto(dbe=dbe) if dbe else None

    async def delete_owned_endpoints(
        self, *, owner: SecretOwner, endpoint_id: Optional[UUID] = None
    ) -> int:
        """Delete one of the person's servers, or (no id) all of them in the
        organization. Returns how many rows went."""
        async with self.engine.session() as session:
            stmt = delete(self.MCPEndpointDBE).where(*self._owned(owner))
            if endpoint_id is not None:
                stmt = stmt.where(self.MCPEndpointDBE.id == endpoint_id)
            result = await session.execute(stmt)
            await session.commit()
            return result.rowcount

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
            # Locked, so the binding cleared below and the address that replaces it
            # are published together.
            dbe = await self._locked(
                session, project_id=project_id, endpoint_id=endpoint.id
            )
            if not dbe:
                return None
            before = map_mcp_endpoint_dbe_to_dto(dbe=dbe)

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
            # An OAuth grant was issued for the old mode and address. Kept on the row,
            # a relay would send the old server's token to the new address.
            old_url = before.data.route.base_url or ""
            if (
                is_oauth_connection_at(before, old_url)
                and not is_oauth_connection_at(endpoint, old_url)
                and dbe.secret_id == before.secret_id
            ):
                dbe.secret_id = None
            flag_modified(dbe, "data")
            flag_modified(dbe, "flags")

            await session.commit()
            await session.refresh(dbe)

            return map_mcp_endpoint_dbe_to_dto(dbe=dbe)

    @asynccontextmanager
    async def oauth_lock(self, *, project_id: UUID, endpoint_id: UUID):
        # A transaction-scoped advisory lock on its own connection, rather than the
        # endpoint row's own lock. The block writes the row, the grant and the attempt
        # through DAOs with their own sessions, and a row lock held on this connection
        # would make every one of those writes wait for it forever, the grant delete
        # included, because its foreign key updates the row. The price is a second
        # pooled connection for as long as the block runs.
        async with self.engine.transaction() as connection:
            await connection.execute(
                text(f"SET LOCAL lock_timeout = '{_OAUTH_LOCK_TIMEOUT}'")
            )
            try:
                await connection.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                    {"key": f"mcps_endpoint_oauth:{project_id}:{endpoint_id}"},
                )
            except DBAPIError as e:
                if is_lock_timeout(e):
                    raise MCPConnectionBusyError() from e
                raise
            yield

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

    @suppress_exceptions()
    async def cache_endpoint_discovery(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint_id: UUID,
        oauth: MCPOAuthData,
    ) -> Optional[MCPEndpoint]:
        return await self._merge_data(
            project_id=project_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
            key="oauth",
            value=oauth,
        )

    @suppress_exceptions()
    async def record_endpoint_check(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint_id: UUID,
        check: MCPEndpointCheck,
    ) -> Optional[MCPEndpoint]:
        return await self._merge_data(
            project_id=project_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
            key="check",
            value=check,
        )

    async def _merge_data(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        endpoint_id: UUID,
        key: str,
        value: BaseModel,
    ) -> Optional[MCPEndpoint]:
        async with self.engine.session() as session:
            dbe = await self._locked(
                session, project_id=project_id, endpoint_id=endpoint_id
            )
            if dbe is None:
                return None

            # One key of the stored data, merged into whatever the row holds now rather
            # than into the copy the caller read before it dialled out (D31).
            data = dict(dbe.data or {})
            data[key] = value.model_dump(mode="json", exclude_none=True)
            dbe.data = data
            flag_modified(dbe, "data")
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

            endpoints = []
            for dbe in dbes:
                try:
                    endpoints.append(map_mcp_endpoint_dbe_to_dto(dbe=dbe))
                except Exception as e:
                    # Validation errors can include credentials from the stored input.
                    log.warning(
                        "Skipping MCP endpoint that could not be mapped",
                        project_id=str(project_id),
                        endpoint_id=str(dbe.id),
                        error_type=type(e).__name__,
                    )

            return endpoints
