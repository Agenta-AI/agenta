from uuid import UUID

from agenta_backend.dbs.secrets.dbes import SecretsDBE
from agenta_backend.models.db.postgres_engine import db_engine as engine
from agenta_backend.core.secrets.interfaces import SecretsDAOInterface
from agenta_backend.core.secrets.dtos import CreateSecretDTO, UpdateSecretDTO
from agenta_backend.dbs.secrets.mappings import (
    map_secrets_dto_to_dbe,
    map_secrets_dbe_to_dto,
    map_secrets_dto_to_dbe_update,
)

from sqlalchemy import select


class SecretsDAO(SecretsDAOInterface):
    def __init__(self):
        pass

    async def create(
        self,
        project_id: UUID,
        create_secret_dto: CreateSecretDTO,
    ):
        secrets_dbe = map_secrets_dto_to_dbe(
            project_id=project_id,
            secret_dto=create_secret_dto,
        )
        async with engine.get_session() as session:
            session.add(secrets_dbe)
            await session.commit()

        secrets_dto = map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)
        return secrets_dto

    async def get(
        self,
        project_id: UUID,
        secret_id: UUID,
    ):
        async with engine.get_session() as session:
            query = select(SecretsDBE).filter_by(
                id=secret_id,
                project_id=project_id,
            )
            result = await session.execute(query)  # type: ignore
            secrets_dbe = result.scalar()

            if secrets_dbe is None:
                return None

            secrets_dto = map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)
            return secrets_dto

    async def list(self, project_id: UUID):
        async with engine.get_session() as session:
            query = select(SecretsDBE).filter_by(project_id=project_id)

            results = await session.execute(query)  # type: ignore
            secrets_dbes = results.scalars().all()
            vault_secret_dtos = [
                map_secrets_dbe_to_dto(secrets_dbe=secret_dbe)
                for secret_dbe in secrets_dbes
            ]
            return vault_secret_dtos

    async def update(
        self,
        project_id: UUID,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
    ):
        async with engine.get_session() as session:
            query = select(SecretsDBE).filter_by(
                id=secret_id,
                project_id=project_id,
            )
            result = await session.execute(query)
            secrets_dbe = result.scalar()

            if secrets_dbe is None:
                return None

            map_secrets_dto_to_dbe_update(
                secrets_dbe=secrets_dbe, update_secret_dto=update_secret_dto
            )

            await session.commit()
            await session.refresh(secrets_dbe)

        updated_secrets_dto = map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)
        return updated_secrets_dto

    async def delete(
        self,
        project_id: UUID,
        secret_id: UUID,
    ):
        async with engine.get_session() as session:
            query = select(SecretsDBE).filter_by(
                id=secret_id,
                project_id=project_id,
            )
            result = await session.execute(query)  # type: ignore
            vault_secret_dbe = result.scalar()
            if vault_secret_dbe is None:
                return

            await session.delete(vault_secret_dbe)
            await session.commit()
