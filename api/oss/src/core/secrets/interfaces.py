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
        project_id: Optional[UUID] = None,
        organization_id: Optional[UUID] = None,
        create_secret_dto: CreateSecretDTO,
    ) -> SecretResponseDTO:
        raise NotImplementedError

    async def get(
        self,
        secret_id: UUID,
        project_id: Optional[UUID] = None,
        organization_id: Optional[UUID] = None,
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def list(
        self, project_id: Optional[UUID] = None, organization_id: Optional[UUID] = None
    ) -> List[SecretResponseDTO]:
        raise NotImplementedError

    async def update(
        self,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        project_id: Optional[UUID] = None,
        organization_id: Optional[UUID] = None,
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def delete(
        self,
        secret_id: UUID,
        project_id: Optional[UUID] = None,
        organization_id: Optional[UUID] = None,
    ) -> None:
        raise NotImplementedError
