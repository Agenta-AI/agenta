from uuid import UUID
from typing import Optional, List

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    UpdateSecretDTO,
    SecretResponseDTO,
)


class SecretsDAOInterface:
    def __init__(self):
        raise NotImplementedError

    async def create(
        self,
        *,
        project_id: UUID,
        create_secret_do: CreateSecretDTO,
    ) -> SecretResponseDTO:
        raise NotImplementedError

    async def get(
        self,
        project_id: UUID,
        secret_id: UUID,
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def list(self, project_id: UUID) -> List[SecretResponseDTO]:
        raise NotImplementedError

    async def update(
        self,
        project_id: UUID,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def delete(
        self,
        project_id: UUID,
        secret_id: UUID,
    ) -> None:
        raise NotImplementedError
