"""The project limit of organization credentials in OSS: never allowed."""

from uuid import UUID

from oss.src.core.secrets.interfaces import ProjectLimitsInterface


class NoProjectLimits(ProjectLimitsInterface):
    """OSS: an organization credential always reaches every project of the organization."""

    async def allows_selected_projects(self, *, organization_id: UUID) -> bool:
        return False
