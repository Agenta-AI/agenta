"""The `run_accounts` claim of a run credential.

The claim lists the ready account of each "user" item of the run, by id, with no value,
no name and no person id: `[{"item_key": ..., "secret_id": ...}]` or
`[{"item_key": ..., "gateway_connection_id": ...}]`. It is signed at the first mint of a
run credential, from one read (`AccountChoicesService.resolve`), and copied unchanged by
every route that re-mints the credential. A "user" item with no entry is not found, and
never falls back to the agent's account.
"""

from typing import Any, List, Optional, Sequence, Tuple
from uuid import UUID

from fastapi import Request
from pydantic import ValidationError

from agenta.sdk.agents.accounts import UserItem, user_item_from_key

from oss.src.core.access.context import get_request_access
from oss.src.core.access.dtos import RequestAccess, RequestCredentialKind, RunEnvelope
from oss.src.core.access.types import InvalidRunClaims
from oss.src.core.account_choices.dtos import MAX_RUN_ITEM_KEYS, ItemAccount, RunAccount
from oss.src.core.account_choices.exceptions import AccountDataUnreadable
from oss.src.core.account_choices.items import run_person_id
from oss.src.core.account_choices.policy import personal_accounts_enabled
from oss.src.core.gateways.run_claims import run_accounts
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def run_accounts_claim(item_accounts: Sequence[ItemAccount]) -> List[dict]:
    """The claim value: only the ready accounts."""
    return [
        RunAccount(
            item_key=item.item_key,
            secret_id=item.secret_id,
            gateway_connection_id=item.gateway_connection_id,
        ).model_dump(mode="json", exclude_none=True)
        for item in item_accounts
        if item.is_ready
        and (item.secret_id is not None or item.gateway_connection_id is not None)
    ]


def run_accounts_from_claim(value: Any) -> Tuple[RunAccount, ...]:
    """The verified claim. Absent is empty; a malformed claim refuses the credential."""
    if value is None:
        return ()
    if not isinstance(value, list):
        raise InvalidRunClaims("run_accounts must be a list")
    try:
        return tuple(RunAccount.model_validate(entry) for entry in value)
    except ValidationError as error:
        raise InvalidRunClaims("run_accounts holds a malformed entry") from error


def run_account(access: Optional[RequestAccess], item_key: str) -> Optional[RunAccount]:
    """The run's account for one item key, or None when the run has none. With the
    deployment switch off, a claim signed while it was on is not read: every "user" item
    is missing."""
    if access is None or not personal_accounts_enabled():
        return None
    return next(
        (account for account in access.run_accounts if account.item_key == item_key),
        None,
    )


async def sign_run_accounts(
    *,
    envelope: RunEnvelope,
    items: Sequence[UserItem],
    artifact_id: Optional[UUID],
) -> Optional[List[dict]]:
    """The one function that resolves the accounts of a new run.

    None, with no read at all, when the run has no "user" items or the deployment switch
    is off. Otherwise one SQL statement, for the run person (none for an API key, an
    installation or a child run: then every item is left out). A run whose agent is not
    known by id reads no account choices; defaults and sign-ins still apply."""
    if not items or not personal_accounts_enabled():
        return None
    if artifact_id is None:
        log.info("[accounts] user items without an agent id; no account choices read")
    from oss.src.core.account_choices.service import (  # noqa: PLC0415
        get_account_choices_service,
    )

    try:
        item_accounts = await get_account_choices_service().resolve(
            organization_id=envelope.authority.organization_id,
            project_id=envelope.authority.project_id,
            artifact_id=artifact_id,
            user_id=run_person_id(envelope),
            items=items,
        )
    except AccountDataUnreadable:
        # A stored row the statement cannot read leaves the "user" items out; it never
        # fails the run. Any other failure stays an error.
        log.error("[accounts] a stored account could not be read; user items left out")
        return None
    return run_accounts_claim(item_accounts)


async def exchange_run_accounts(
    request: Request,
    *,
    envelope: RunEnvelope,
    workflow_id: Optional[UUID],
    item_keys: Optional[Sequence[str]],
) -> Optional[List[dict]]:
    """The `run_accounts` claim of a credential an exchange returns.

    Both exchanges use it: the access exchange (`GET /access/permissions/check`) and the
    gateway credentials exchange (`POST /gateways/credentials`). A run credential carries
    its own claim on, unchanged. Otherwise this is a first mint: the item keys name the
    caller's "user" items (a playground or chat turn, or the server view's tool list), and
    the accounts resolve in one statement for the run person of the caller's own
    envelope. The keys only select which of the caller's own accounts to look up, so a
    caller can never reach another person's account. No keys: no read."""
    access = get_request_access()
    if (
        access is not None
        and access.credential_kind == RequestCredentialKind.RUN_CREDENTIAL
    ):
        # A renewed credential drops the claim once the switch is off.
        if not personal_accounts_enabled():
            return None
        return run_accounts(request) or None
    items = [
        item
        for item in (
            user_item_from_key(key) for key in (item_keys or ())[:MAX_RUN_ITEM_KEYS]
        )
        if item is not None
    ]
    return await sign_run_accounts(
        envelope=envelope, items=items, artifact_id=workflow_id
    )
