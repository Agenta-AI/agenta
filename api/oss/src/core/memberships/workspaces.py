"""The workspace id the API answers for a project, until the classic app is retired.

Projects are walls inside an organization; workspaces are being removed (CONTRACT section
1). Until then every response, token and link still carries a `workspace_id`. A project
that has a workspace answers it; a project without one (written by workspace removal step
2) answers its organization id, which every reader accepts wherever a workspace id goes.
"""

from typing import Optional
from uuid import UUID


def legacy_workspace_id(
    *,
    workspace_id: Optional[UUID],
    organization_id: UUID,
) -> UUID:
    """The project's workspace id, or its organization id when it has none."""
    return workspace_id or organization_id
