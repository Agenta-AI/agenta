import os
from uuid import UUID

from agenta_backend.core.secrets.interfaces import SecretsDAOInterface
from agenta_backend.core.secrets.context import set_data_encryption_key
from agenta_backend.core.secrets.dtos import CreateSecretDTO, UpdateSecretDTO


class VaultService:
    def __init__(self, secrets_dao: SecretsDAOInterface):
        self.secrets_dao = secrets_dao
        self._data_encryption_key = os.getenv("AGENTA_ENCRYPTION_KEY")

    async def create_secret(
        self,
        *,
        project_id: UUID,
        create_secret_dto: CreateSecretDTO,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.create(
                project_id=project_id,
                create_secret_dto=create_secret_dto,
            )
            return secret_dto

    async def get_secret(
        self,
        project_id: UUID,
        secret_id: UUID,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.get(
                project_id=project_id,
                secret_id=secret_id,
            )
            return secret_dto

    async def list_secrets(self, project_id: UUID):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secrets_dtos = await self.secrets_dao.list(project_id=project_id)
            return secrets_dtos

    async def update_secret(
        self,
        project_id: UUID,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.update(
                project_id=project_id,
                secret_id=secret_id,
                update_secret_dto=update_secret_dto,
            )
            return secret_dto

    async def delete_secret(
        self,
        project_id: UUID,
        secret_id: UUID,
    ) -> None:
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            await self.secrets_dao.delete(
                project_id=project_id,
                secret_id=secret_id,
            )
            return
