from uuid import UUID
from typing import Callable, List, Optional

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

    async def get_by_id(
        self,
        secret_id: UUID,
        project_id: Optional[UUID] = None,
        organization_id: Optional[UUID] = None,
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def get_by_slug(
        self,
        secret_slug: str,
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
        user_id: Optional[UUID] = None,
        # Called with the row as it stands under the write lock, before the update is
        # applied. Every decision that reads stored state belongs here: a check made
        # against a snapshot read earlier is a check against a row another writer can
        # still have replaced. It may raise to refuse the update.
        resolve_update: Optional[Callable[[SecretResponseDTO], None]] = None,
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def delete(
        self,
        secret_id: UUID,
        project_id: Optional[UUID] = None,
        organization_id: Optional[UUID] = None,
    ) -> None:
        raise NotImplementedError
