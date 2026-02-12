from typing import List, Optional
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.tools.interfaces import ToolsDAOInterface
from oss.src.core.tools.dtos import Connection, ConnectionCreate

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.tools.dbes import ConnectionDBE
from oss.src.dbs.postgres.tools.mappings import (
    map_connection_create_to_dbe,
    map_connection_dbe_to_dto,
)


log = get_module_logger(__name__)


class ToolsDAO(ToolsDAOInterface):
    def __init__(self, *, ConnectionDBE: type = ConnectionDBE):
        self.ConnectionDBE = ConnectionDBE

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        #
        connection_create: ConnectionCreate,
        #
        provider_connection_id: Optional[str] = None,
        auth_config_id: Optional[str] = None,
    ) -> Optional[Connection]:
        dbe = map_connection_create_to_dbe(
            project_id=project_id,
            user_id=user_id,
            #
            provider_key=provider_key,
            integration_key=integration_key,
            #
            dto=connection_create,
            #
            provider_connection_id=provider_connection_id,
            auth_config_id=auth_config_id,
        )

        try:
            async with engine.core_session() as session:
                session.add(dbe)
                await session.commit()
                await session.refresh(dbe)

                return map_connection_dbe_to_dto(dbe=dbe)

        except IntegrityError as e:
            error_str = str(e.orig) if e.orig else str(e)
            if "uq_tool_connections_project_provider_integration_slug" in error_str:
                raise EntityCreationConflict(
                    entity="Connection",
                    message="Connection with slug '{{slug}}' already exists for this integration.".replace(
                        "{{slug}}", connection_create.slug
                    ),
                    conflict={
                        "provider_key": provider_key,
                        "integration_key": integration_key,
                        "slug": connection_create.slug,
                    },
                ) from e
            raise

    @suppress_exceptions(default=None)
    async def get_connection(
        self,
        *,
        project_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> Optional[Connection]:
        async with engine.core_session() as session:
            stmt = (
                select(self.ConnectionDBE)
                .filter(self.ConnectionDBE.project_id == project_id)
                .filter(self.ConnectionDBE.provider_key == provider_key)
                .filter(self.ConnectionDBE.integration_key == integration_key)
                .filter(self.ConnectionDBE.slug == connection_slug)
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
        project_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        connection_slug: str,
        #
        is_valid: Optional[bool] = None,
        is_active: Optional[bool] = None,
        status: Optional[str] = None,
        provider_connection_id: Optional[str] = None,
    ) -> Optional[Connection]:
        async with engine.core_session() as session:
            stmt = (
                select(self.ConnectionDBE)
                .filter(self.ConnectionDBE.project_id == project_id)
                .filter(self.ConnectionDBE.provider_key == provider_key)
                .filter(self.ConnectionDBE.integration_key == integration_key)
                .filter(self.ConnectionDBE.slug == connection_slug)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            if is_valid is not None:
                dbe.is_valid = is_valid
            if is_active is not None:
                dbe.is_active = is_active
            if status is not None:
                dbe.status = status
            if provider_connection_id is not None:
                dbe.provider_connection_id = provider_connection_id

            dbe.updated_at = datetime.now(timezone.utc)

            await session.commit()
            await session.refresh(dbe)

            return map_connection_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=False)
    async def delete_connection(
        self,
        *,
        project_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> bool:
        async with engine.core_session() as session:
            stmt = (
                delete(self.ConnectionDBE)
                .where(self.ConnectionDBE.project_id == project_id)
                .where(self.ConnectionDBE.provider_key == provider_key)
                .where(self.ConnectionDBE.integration_key == integration_key)
                .where(self.ConnectionDBE.slug == connection_slug)
            )

            result = await session.execute(stmt)
            await session.commit()

            return result.rowcount > 0

    @suppress_exceptions(default=[])
    async def query_connections(
        self,
        *,
        project_id: UUID,
        #
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
    ) -> List[Connection]:
        async with engine.core_session() as session:
            stmt = select(self.ConnectionDBE).filter(
                self.ConnectionDBE.project_id == project_id,
            )

            if provider_key:
                stmt = stmt.filter(self.ConnectionDBE.provider_key == provider_key)

            if integration_key:
                stmt = stmt.filter(
                    self.ConnectionDBE.integration_key == integration_key
                )

            stmt = stmt.order_by(self.ConnectionDBE.created_at.desc())

            result = await session.execute(stmt)
            dbes = result.scalars().all()

            return [map_connection_dbe_to_dto(dbe=dbe) for dbe in dbes]
