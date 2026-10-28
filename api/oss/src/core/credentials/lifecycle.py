"""A person's own credentials end when they leave an organization (M7, design D9)."""

from typing import Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class PersonalCredentialsService:
    """Deletes everything a person owns in one organization: provider keys, Composio
    connections (provider revoke best effort) and, later, personal MCP servers."""

    def __init__(self, *, vault_service, connections_service) -> None:
        self.vault_service = vault_service
        self.connections_service = connections_service

    async def end_for_member(self, *, organization_id: UUID, user_id: UUID) -> int:
        removed = 0
        for secret in await self.vault_service.list_personal_secrets(
            organization_id=organization_id, user_id=user_id
        ):
            if secret.id and await self.vault_service.delete_personal_secret(
                organization_id=organization_id,
                user_id=user_id,
                secret_id=secret.id,
            ):
                removed += 1
        removed += await self.connections_service.delete_personal_connections(
            organization_id=organization_id, user_id=user_id
        )
        log.info(
            "[credentials] personal credentials ended for a member",
            organization_id=str(organization_id),
            removed=removed,
        )
        return removed


_service: Optional[PersonalCredentialsService] = None


def register_personal_credentials_service(service: PersonalCredentialsService) -> None:
    global _service
    _service = service


def get_personal_credentials_service() -> Optional[PersonalCredentialsService]:
    return _service
