"""A person's own accounts end when they leave an organization.

`MembershipsService.remove_member` calls the hook that `api/entrypoints/routers.py` sets,
so both paths that remove a member (the workspace route and the admin accounts service)
delete the person's accounts there. The foreign keys then delete their account choices.
The person's accounts in other organizations stay.
"""

from uuid import UUID

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class AccountsLifecycle:
    def __init__(self, *, vault_service, connections_service) -> None:
        self.vault_service = vault_service
        self.connections_service = connections_service

    async def end_for_member(self, *, organization_id: UUID, user_id: UUID) -> int:
        """Delete every secret row (custom secrets, logins, MCP sign-ins) and every
        Composio connection the person owns in the organization."""
        removed = await self.vault_service.delete_personal_secrets(
            organization_id=organization_id, user_id=user_id
        )
        removed += await self.connections_service.delete_personal_connections(
            organization_id=organization_id, user_id=user_id
        )
        log.info(
            "[accounts] a member's own accounts ended",
            organization_id=str(organization_id),
            removed=removed,
        )
        return removed
