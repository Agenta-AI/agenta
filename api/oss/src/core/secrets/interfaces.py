from abc import ABC, abstractmethod
from uuid import UUID
from typing import Callable, List, Optional, Sequence

from oss.src.core.secrets.dtos import (
    CachedEffectiveSecrets,
    CreateSecretDTO,
    SecretOwner,
    UpdateSecretDTO,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import SecretAvailability
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
    """Storage of the vault, addressed by owner (M5).

    The existing methods take `owner: SecretOwner` instead of the column pair; the DAO maps
    the kind to the column. A USER owner is refused in M5. With an ORGANIZATION owner the
    methods serve EE SSO (any kind) and, with `shareable=True`, organization connections:
    shareable kinds only, read with their selected projects.
    """

    def __init__(self):
        raise NotImplementedError

    async def create(
        self,
        *,
        owner: SecretOwner,
        create_secret_dto: CreateSecretDTO,
        management: Optional[SecretManagementDTO] = None,
        availability: Optional[SecretAvailability] = None,
        project_ids: Sequence[UUID] = (),
        user_id: Optional[UUID] = None,
    ) -> SecretResponseDTO:
        """One transaction. With `availability` (an organization connection), the row
        and its selected projects of the same organization; any refusal leaves no row."""
        raise NotImplementedError

    async def get_by_id(
        self, *, owner: SecretOwner, secret_id: UUID, shareable: bool = False
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def get_by_slug(
        self, *, owner: SecretOwner, secret_slug: str
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def list(
        self, *, owner: SecretOwner, shareable: bool = False
    ) -> List[SecretResponseDTO]:
        raise NotImplementedError

    async def update(
        self,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        user_id: Optional[UUID] = None,
        # Called with the row as it stands under the write lock, before the update is
        # applied. Every decision that reads stored state belongs here: a check made
        # against a snapshot read earlier is a check against a row another writer can
        # still have replaced. It may raise to refuse the update, and it may return None
        # to leave the row untouched: no write, no commit.
        resolve_update: Optional[
            Callable[[SecretResponseDTO, UpdateSecretDTO], Optional[UpdateSecretDTO]]
        ] = None,
        shareable: bool = False,
    ) -> Optional[SecretResponseDTO]:
        raise NotImplementedError

    async def delete(
        self,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        authorize_delete: Optional[Callable[[SecretResponseDTO], None]] = None,
        shareable: bool = False,
    ) -> Optional[SecretResponseDTO]:
        """The deleted row, or None when the owner holds no such row."""
        raise NotImplementedError

    async def load_effective(self, *, project_id: UUID) -> CachedEffectiveSecrets:
        """ONE statement: the project row's organization, the project's rows, and the
        shareable organization rows available to the project. An unknown project
        answers `organization_id=None` and no rows."""
        raise NotImplementedError

    async def set_availability(
        self,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        availability: SecretAvailability,
        project_ids: Sequence[UUID],
        user_id: Optional[UUID],
    ) -> Optional[SecretResponseDTO]:
        """Under the row lock: the availability and the selected projects of an
        organization connection, replaced in one transaction."""
        raise NotImplementedError

    async def list_organization_project_ids(
        self, *, organization_id: UUID
    ) -> List[UUID]:
        raise NotImplementedError


class ProjectLimitsInterface(ABC):
    """Whether an organization may limit a credential to selected projects."""

    @abstractmethod
    async def allows_selected_projects(self, *, organization_id: UUID) -> bool:
        raise NotImplementedError
