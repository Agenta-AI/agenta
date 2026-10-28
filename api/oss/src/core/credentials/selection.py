"""Selecting a person's own credential for a `caller_account` connection (M7).

One path for every store (provider keys, Composio connections, MCP servers and grants):
find the person the run acts for, check the deployment gate and the organization policy,
then read that person's own credential for the service. Each refusal names what the
person can do. No refusal falls back to another account.
"""

from typing import Awaitable, Callable, Optional, TypeVar
from uuid import UUID

from oss.src.core.access.dtos import PrincipalKind, RunAuthority
from oss.src.core.credentials.bindings import caller_user_id
from oss.src.core.credentials.policy import (
    PersonalCredentialRefused,
    check_personal_credentials_allowed,
)

T = TypeVar("T")


def no_caller_refusal(
    *, authority: Optional[RunAuthority], label: str
) -> PersonalCredentialRefused:
    if authority is not None and authority.principal.kind == PrincipalKind.INSTALLATION:
        return PersonalCredentialRefused(
            code="channel_user_not_linked",
            message=f"Link your Agenta account to use your own {label} account here.",
        )
    return PersonalCredentialRefused(
        code="no_person",
        message=(
            f"{label} is set to use each person's own account, and this run is not "
            "started by a person."
        ),
    )


def account_missing_refusal(*, label: str) -> PersonalCredentialRefused:
    return PersonalCredentialRefused(
        code="personal_account_missing",
        message=f"Connect your {label} account to use this agent.",
    )


async def select_personal_credential(
    *,
    authority: Optional[RunAuthority],
    label: str,
    read: Callable[[UUID], Awaitable[Optional[T]]],
) -> T:
    """The credential `read` finds for the person the run acts for.

    `label` is the service's display name, for the refusal. Raises
    `PersonalCredentialRefused`; never returns another account."""

    caller = caller_user_id(authority)
    if authority is None or caller is None:
        raise no_caller_refusal(authority=authority, label=label)
    await check_personal_credentials_allowed(organization_id=authority.organization_id)
    found = await read(caller)
    if found is None:
        raise account_missing_refusal(label=label)
    return found
