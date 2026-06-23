from typing import List, Optional
from uuid import UUID

from oss.src.utils.env import env
from oss.src.core.secrets.interfaces import SecretsDAOInterface
from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.dtos import CreateSecretDTO, UpdateSecretDTO
from oss.src.core.secrets.connections import (
    ConnectionView,
    ResolvedConnectionResult,
    project_connection_view,
    resolve_connection,
)


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
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.create(
                project_id=project_id,
                organization_id=organization_id,
                create_secret_dto=create_secret_dto,
            )
            return secret_dto

    async def get_secret(
        self,
        secret_id: UUID,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ):
        with set_data_encryption_key(
            data_encryption_key=self._data_encryption_key,
        ):
            secret_dto = await self.secrets_dao.get(
                secret_id=secret_id,
                project_id=project_id,
                organization_id=organization_id,
            )
            return secret_dto

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

    async def list_connections(
        self,
        *,
        project_id: UUID | None = None,
        organization_id: UUID | None = None,
    ) -> List[ConnectionView]:
        """Project the project's connection-bearing secrets into non-secret views. No key material."""
        secrets = await self.list_secrets(
            project_id=project_id,
            organization_id=organization_id,
        )
        views: List[ConnectionView] = []
        for secret in secrets or []:
            view = project_connection_view(secret)
            if view is not None:
                views.append(view)
        return views

    async def resolve_connection(
        self,
        *,
        project_id: UUID,
        model_provider: Optional[str],
        model_id: str,
        connection_mode: str,
        connection_slug: Optional[str],
        harness: str,
        backend: Optional[str] = None,
    ) -> ResolvedConnectionResult:
        """Resolve one connection for ``project_id``, returning one least-privilege result.

        Lists the project's decrypted secrets, then defers to the pure deterministic resolver
        (``core.secrets.connections.resolve_connection``). Domain exceptions raised there are
        caught at the router boundary. ``backend`` is accepted for parity with the auth context
        but is not used by v1's capability reject (provider/mode only).
        """
        del backend  # accepted for auth-context parity; v1 capability reject is provider/mode only
        secrets = await self.list_secrets(project_id=project_id)
        return resolve_connection(
            secrets=list(secrets or []),
            model_provider=model_provider,
            model_id=model_id,
            connection_mode=connection_mode,
            connection_slug=connection_slug,
            harness=harness,
        )
