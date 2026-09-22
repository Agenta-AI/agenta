from abc import ABC, abstractmethod
from uuid import UUID
from typing import Callable, List, Optional

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    UpdateSecretDTO,
    SecretResponseDTO,
)
from oss.src.core.secrets.managed import SecretManagementDTO


class LLMEndpointRegistrarInterface(ABC):
    """Keeps the LLM gateway's view of a connection in step with the stored secret.

    Declared on the secrets side and implemented on the gateways side: the vault owns the
    intent ("this connection exists, at this address, speaking this protocol"), the gateway
    owns the row. A direct `LLMGatewayService` injection would be a construction cycle,
    since that service already takes a resolver built over `VaultService`.

    Implementations never raise: a gateway failure must not make the vault unusable.
    """

    @abstractmethod
    async def register(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        secret: SecretResponseDTO,
    ) -> None:
        """Upsert the endpoint this secret stands for, addressed by the secret's slug.

        Upsert rather than insert so a secret written before the gateway knew about it
        heals on its first edit.
        """
        raise NotImplementedError

    @abstractmethod
    async def deregister(
        self,
        *,
        project_id: UUID,
        #
        secret: SecretResponseDTO,
    ) -> None:
        """Drop the endpoint this secret stands for."""
        raise NotImplementedError


class SecretsDAOInterface:
    def __init__(self):
        raise NotImplementedError

    async def create(
        self,
        *,
        project_id: Optional[UUID] = None,
        organization_id: Optional[UUID] = None,
        create_secret_dto: CreateSecretDTO,
        management: Optional[SecretManagementDTO] = None,
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
        # still have replaced. It may raise to refuse the update, and it may return None
        # to leave the row untouched: no write, no commit.
        resolve_update: Optional[
            Callable[[SecretResponseDTO, UpdateSecretDTO], Optional[UpdateSecretDTO]]
        ] = None,
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def delete(
        self,
        secret_id: UUID,
        project_id: Optional[UUID] = None,
        organization_id: Optional[UUID] = None,
        authorize_delete: Optional[Callable[[SecretResponseDTO], None]] = None,
    ) -> None:
        raise NotImplementedError
