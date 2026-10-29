"""Who may act on a person's own accounts: only that person, signed in.

Two checks, in this order:

- Person: the caller's principal is a human, the request carries no run envelope, and
  the request has an organization. No role, admin, API key or run credential reaches a
  person's accounts. Otherwise `403`, code `user_required`.
- Switch: the deployment switch `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` is on.
  Otherwise `403`, code `personal_accounts_disabled`, for reads too, so the screens can
  read the switch from one answer.
"""

from typing import Optional, Tuple
from uuid import UUID

from fastapi import HTTPException, Request, status

from oss.src.core.access.context import get_request_access
from oss.src.core.access.dtos import PrincipalKind
from oss.src.core.account_choices.policy import (
    PersonalAccountsDisabled,
    personal_accounts_enabled,
)

USER_REQUIRED_CODE = "user_required"


def _person(request: Request) -> Optional[Tuple[UUID, UUID]]:
    access = get_request_access()
    organization_id = getattr(request.state, "organization_id", None)
    if (
        access is None
        or access.principal.kind != PrincipalKind.HUMAN
        or access.envelope is not None
        or not organization_id
    ):
        return None
    return UUID(str(organization_id)), access.principal.id


def require_person(request: Request) -> Tuple[UUID, UUID]:
    """The organization and the person a person route acts for, after both checks."""
    person = _person(request)
    if person is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": USER_REQUIRED_CODE,
                "message": "Only you can manage your own accounts, signed in to the app.",
            },
        )
    if not personal_accounts_enabled():
        error = PersonalAccountsDisabled()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": error.code, "message": error.message},
        )
    return person


def person_or_none(request: Request) -> Optional[Tuple[UUID, UUID]]:
    """The organization and the person, when both checks pass; otherwise None. For a
    route that also serves project rows and must not refuse other callers."""
    if not personal_accounts_enabled():
        return None
    return _person(request)
