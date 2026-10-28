"""Who may manage a person's own credentials (M7): only that person, signed in."""

from typing import Tuple
from uuid import UUID

from fastapi import HTTPException, Request, status

from oss.src.core.access.context import get_request_access
from oss.src.core.access.dtos import PrincipalKind
from oss.src.core.credentials.policy import (
    PersonalCredentialRefused,
    check_personal_credentials_allowed,
)


async def require_person(
    request: Request, *, enforce_policy: bool = True
) -> Tuple[UUID, UUID]:
    """The organization and person a personal credential route acts for.

    Only the person themselves, in a browser or with their own session: no role, admin,
    API key or run credential reaches another person's credentials. Nothing is stored
    or listed while the deployment gate is closed or the organization's policy forbids
    personal accounts."""
    access = get_request_access()
    organization_id = getattr(request.state, "organization_id", None)
    if (
        access is None
        or access.principal.kind != PrincipalKind.HUMAN
        or access.envelope is not None
        or not organization_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only you can manage your personal accounts, signed in to the app.",
        )
    organization_id = UUID(str(organization_id))
    # The policy stops new personal credentials, never a person seeing or removing the
    # ones they already stored.
    if not enforce_policy:
        return organization_id, access.principal.id
    try:
        await check_personal_credentials_allowed(organization_id=organization_id)
    except PersonalCredentialRefused as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": e.code, "message": e.message},
        ) from e
    return organization_id, access.principal.id
