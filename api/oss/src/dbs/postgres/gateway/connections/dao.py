from typing import List, Optional
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.gateway.connections.interfaces import ConnectionsDAOInterface
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
)

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE
from oss.src.dbs.postgres.gateway.connections.mappings import (
    map_connection_create_to_dbe,
    map_connection_dbe_to_dto,
)


log = get_module_logger(__name__)

_SLUG_INDEXES = (
    "uq_gateway_connections_project_provider_integration_slug",
    "uq_gateway_connections_user_provider_integration_slug",
)
_DEFAULT_INDEX = "uq_gateway_connections_user_default"


class ConnectionsDAO(ConnectionsDAOInterface):
    def __init__(
        self,
        *,
        ConnectionDBE: type = ConnectionDBE,
        engine: TransactionsEngine = None,
    ):
        self.ConnectionDBE = ConnectionDBE
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    def _owner_filter(
        self, *, project_id: Optional[UUID], owner: Optional[SecretOwner]
    ):
        """The rows one caller addresses: a person's own rows (person AND organization),
        or a project's rows. A project read never sees a person's row, and the reverse.
        Only a person owns connections through `owner`."""
        if owner is not None:
            if owner.kind != SecretOwnerKind.USER:
                raise ValueError("a connection owner is a person")
            return (
                self.ConnectionDBE.organization_id == owner.organization_id,
                self.ConnectionDBE.user_id == owner.id,
            )
        if project_id is None:
            # `project_id IS NULL` would match every person's and organization's row.
            raise ValueError("a connection read needs a project or a person owner")
        return (self.ConnectionDBE.project_id == project_id,)

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_connection(
        self,
        *,
        project_id: Optional[UUID],
        user_id: UUID,
        #
        connection_create: ConnectionCreate,
        owner: Optional[SecretOwner] = None,
    ) -> Optional[Connection]:
        """Insert a new connection row. Raises EntityCreationConflict on slug collision.

        With a user `owner`, the row is that person's own, with no project. The person's
        first connection for the integration becomes the default. When two creates race,
        the default index refuses one, and that create is stored as not the default."""
        is_default = owner is not None and not await self._has_personal_connections(
            owner=owner,
            provider_key=connection_create.provider_key,
            integration_key=connection_create.integration_key,
        )
        try:
            return await self._insert(
                project_id=project_id,
                user_id=user_id,
                connection_create=connection_create,
                owner=owner,
                is_default=is_default,
            )
        except IntegrityError as e:
            error_str = str(e.orig) if e.orig else str(e)
            if is_default and _DEFAULT_INDEX in error_str:
                try:
                    return await self._insert(
                        project_id=project_id,
                        user_id=user_id,
                        connection_create=connection_create,
                        owner=owner,
                        is_default=False,
                    )
                except IntegrityError as retry_error:
                    e = retry_error
                    error_str = str(e.orig) if e.orig else str(e)
            if any(index in error_str for index in _SLUG_INDEXES):
                raise EntityCreationConflict(
                    entity="Connection",
                    message="Connection with slug '{{slug}}' already exists for this integration.".replace(
                        "{{slug}}", connection_create.slug
                    ),
                    conflict={
                        "provider_key": connection_create.provider_key,
                        "integration_key": connection_create.integration_key,
                        "slug": connection_create.slug,
                    },
                ) from e
            raise e

    async def _insert(
        self,
        *,
        project_id: Optional[UUID],
        user_id: UUID,
        connection_create: ConnectionCreate,
        owner: Optional[SecretOwner],
        is_default: bool,
    ) -> Connection:
        dbe = map_connection_create_to_dbe(
            project_id=project_id,
            user_id=user_id,
            #
            dto=connection_create,
            owner=owner,
            is_default=is_default,
        )
        async with self.engine.session() as session:
            session.add(dbe)
            await session.commit()
            await session.refresh(dbe)
            return map_connection_dbe_to_dto(dbe=dbe)

    async def _has_personal_connections(
        self, *, owner: SecretOwner, provider_key, integration_key: str
    ) -> bool:
        async with self.engine.session() as session:
            result = await session.execute(
                select(func.count())
                .select_from(self.ConnectionDBE)
                .filter(
                    *self._owner_filter(project_id=None, owner=owner),
                    self.ConnectionDBE.provider_key
                    == getattr(provider_key, "value", provider_key),
                    self.ConnectionDBE.integration_key == integration_key,
                )
            )
            return (result.scalar() or 0) > 0

    @suppress_exceptions(default=None)
    async def get_connection(
        self,
        *,
        project_id: Optional[UUID],
        connection_id: UUID,
        owner: Optional[SecretOwner] = None,
    ) -> Optional[Connection]:
        """Fetch a connection by ID, scoped to the project or to the person `owner`.
        Returns None if not found."""
        async with self.engine.session() as session:
            stmt = (
                select(self.ConnectionDBE)
                .filter(*self._owner_filter(project_id=project_id, owner=owner))
                .filter(self.ConnectionDBE.id == connection_id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_connection_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None)
    async def update_connection(
        self,
        *,
        project_id: Optional[UUID],
        connection_id: UUID,
        owner: Optional[SecretOwner] = None,
        #
        is_valid: Optional[bool] = None,
        is_active: Optional[bool] = None,
        provider_connection_id: Optional[str] = None,
        data_update: Optional[dict] = None,
    ) -> Optional[Connection]:
        """Partially update flags and/or data for a connection. Returns updated DTO or None."""
        async with self.engine.session() as session:
            stmt = (
                select(self.ConnectionDBE)
                .filter(*self._owner_filter(project_id=project_id, owner=owner))
                .filter(self.ConnectionDBE.id == connection_id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            # Update flags
            if is_valid is not None or is_active is not None:
                flags = {**(dbe.flags or {})}
                if is_valid is not None:
                    flags["is_valid"] = is_valid
                if is_active is not None:
                    flags["is_active"] = is_active
                dbe.flags = flags
                flag_modified(dbe, "flags")

            # Update data fields
            data_patch: dict = {}
            if provider_connection_id is not None:
                data_patch["connected_account_id"] = provider_connection_id
            if data_update:
                data_patch.update(data_update)
            if data_patch:
                dbe.data = {**(dbe.data or {}), **data_patch}
                flag_modified(dbe, "data")

            dbe.updated_at = datetime.now(timezone.utc)

            await session.commit()
            await session.refresh(dbe)

            return map_connection_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=False)
    async def delete_connection(
        self,
        *,
        project_id: Optional[UUID],
        connection_id: UUID,
        owner: Optional[SecretOwner] = None,
    ) -> bool:
        """Hard-delete a connection row. Returns True if a row was deleted. Deleting a
        person's default promotes no other connection."""
        async with self.engine.session() as session:
            stmt = (
                delete(self.ConnectionDBE)
                .where(*self._owner_filter(project_id=project_id, owner=owner))
                .where(self.ConnectionDBE.id == connection_id)
            )

            result = await session.execute(stmt)
            await session.commit()

            return result.rowcount > 0

    @suppress_exceptions(default=[])
    async def query_connections(
        self,
        *,
        project_id: Optional[UUID],
        #
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
        is_active: Optional[bool] = True,
        owner: Optional[SecretOwner] = None,
    ) -> List[Connection]:
        """List connections with optional filters. Defaults to active-only (is_active=True)."""
        async with self.engine.session() as session:
            stmt = select(self.ConnectionDBE).filter(
                *self._owner_filter(project_id=project_id, owner=owner)
            )

            if provider_key:
                stmt = stmt.filter(self.ConnectionDBE.provider_key == provider_key)

            if integration_key:
                stmt = stmt.filter(
                    self.ConnectionDBE.integration_key == integration_key
                )

            if is_active is not None:
                stmt = stmt.filter(
                    self.ConnectionDBE.flags.contains({"is_active": is_active})
                )

            stmt = stmt.order_by(self.ConnectionDBE.created_at.desc())

            result = await session.execute(stmt)
            dbes = result.scalars().all()

            return [map_connection_dbe_to_dto(dbe=dbe) for dbe in dbes]

    @suppress_exceptions(default=None)
    async def activate_connection_by_provider_id(
        self,
        *,
        project_id: Optional[UUID],
        provider_connection_id: str,
        owner: Optional[SecretOwner] = None,
    ) -> Optional[Connection]:
        """Set is_valid=True and is_active=True for the connection matching the provider ID."""
        async with self.engine.session() as session:
            stmt = (
                select(self.ConnectionDBE)
                .filter(
                    *self._owner_filter(project_id=project_id, owner=owner),
                    self.ConnectionDBE.data["connected_account_id"].astext
                    == provider_connection_id,
                )
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            flags = {**(dbe.flags or {})}
            flags["is_valid"] = True
            flags["is_active"] = True
            dbe.flags = flags
            flag_modified(dbe, "flags")

            dbe.updated_at = datetime.now(timezone.utc)

            await session.commit()
            await session.refresh(dbe)

            return map_connection_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None)
    async def find_connection_by_provider_id(
        self,
        *,
        project_id: UUID,
        provider_connection_id: str,
    ) -> Optional[Connection]:
        """Lookup a connection by provider-side connected_account_id within a project."""
        async with self.engine.session() as session:
            stmt = (
                select(self.ConnectionDBE)
                .filter(
                    self.ConnectionDBE.project_id == project_id,
                    self.ConnectionDBE.data["connected_account_id"].astext
                    == provider_connection_id,
                )
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_connection_dbe_to_dto(dbe=dbe)

    # -- a person's own connections ----------------------------------------------------

    async def delete_personal_connections(self, *, owner: SecretOwner) -> int:
        """Delete every connection of the person in the organization."""
        async with self.engine.session() as session:
            result = await session.execute(
                delete(self.ConnectionDBE).where(
                    *self._owner_filter(project_id=None, owner=owner)
                )
            )
            await session.commit()
            return result.rowcount or 0

    async def make_default(
        self, *, owner: SecretOwner, connection_id: UUID
    ) -> Optional[Connection]:
        """One transaction: clear the person's old default of the integration, then set
        this connection. None when the connection is not the person's.

        Every connection of the person for that integration is locked first, so two calls
        at once run one after the other instead of both clearing and both setting."""
        owner_filter = self._owner_filter(project_id=None, owner=owner)
        async with self.engine.session() as session:
            target = (
                select(
                    self.ConnectionDBE.provider_key,
                    self.ConnectionDBE.integration_key,
                )
                .filter(*owner_filter, self.ConnectionDBE.id == connection_id)
                .subquery()
            )
            result = await session.execute(
                select(self.ConnectionDBE)
                .filter(
                    *owner_filter,
                    self.ConnectionDBE.provider_key == target.c.provider_key,
                    self.ConnectionDBE.integration_key == target.c.integration_key,
                )
                .order_by(self.ConnectionDBE.id)
                .with_for_update(of=self.ConnectionDBE)
            )
            rows = list(result.scalars())
            dbe = next((row for row in rows if row.id == connection_id), None)
            if dbe is None:
                return None
            if not dbe.is_default:
                for row in rows:
                    if row.is_default:
                        row.is_default = False
                await session.flush()
                dbe.is_default = True
                dbe.updated_at = datetime.now(timezone.utc)
                dbe.updated_by_id = owner.id
                await session.commit()
                await session.refresh(dbe)
            return map_connection_dbe_to_dto(dbe=dbe)
