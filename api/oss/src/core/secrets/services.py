from uuid import UUID, uuid4

from oss.src.utils.env import env
from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.interfaces import SecretsDAOInterface
from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.dtos import CreateSecretDTO, UpdateSecretDTO


class VaultService:
    def __init__(self, secrets_dao: SecretsDAOInterface):
        self.secrets_dao = secrets_dao
        self._data_encryption_key = env.agenta.crypt_key

    async def create_secret(
        self,
        *,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        create_secret_dto: CreateSecretDTO,
    ):
        # custom_secret is addressed by slug; derive one from the name when absent.
        if (
            not create_secret_dto.slug
            and create_secret_dto.secret.kind == SecretKind.CUSTOM_SECRET
            and create_secret_dto.header
            and create_secret_dto.header.name
        ):
            create_secret_dto.slug = get_slug_from_name_and_id(
                create_secret_dto.header.name,
                uuid4(),
            )

        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.create(
                project_id=project_id,
                organization_id=organization_id,
                create_secret_dto=create_secret_dto,
            )
            return secret_dto

    async def get_secret_by_id(
        self,
        secret_id: UUID,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.get_by_id(
                secret_id=secret_id,
                project_id=project_id,
                organization_id=organization_id,
            )
            return secret_dto

    async def get_secret_by_slug(
        self,
        secret_slug: str,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            return await self.secrets_dao.get_by_slug(
                secret_slug=secret_slug,
                project_id=project_id,
                organization_id=organization_id,
            )

    async def list_secrets(
        self,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secrets_dtos = await self.secrets_dao.list(
                project_id=project_id,
                organization_id=organization_id,
            )
            return secrets_dtos

    async def update_secret(
        self,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
        user_id: UUID | None = None,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.update(
                secret_id=secret_id,
                update_secret_dto=update_secret_dto,
                project_id=project_id,
                organization_id=organization_id,
                user_id=user_id,
            )
            return secret_dto

    async def delete_secret(
        self,
        secret_id: UUID,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ) -> None:
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            await self.secrets_dao.delete(
                secret_id=secret_id,
                project_id=project_id,
                organization_id=organization_id,
            )
            return
