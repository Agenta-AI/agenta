"""Selecting a person's own credential for a `caller_account` connection (M7).

One path for every store (provider keys, Composio connections, MCP servers and grants):
find the person the run acts for, check the deployment gate and the organization policy,
then read that person's own credential for the service. Each refusal names what the
person can do. No refusal falls back to another account.
"""

from collections import OrderedDict
from typing import Any, Awaitable, Callable, Optional, Tuple, TypeVar
from uuid import UUID

from oss.src.core.access.dtos import PrincipalKind, RunAuthority
from oss.src.core.credentials.bindings import Binding, ConnectionKey, caller_user_id
from oss.src.core.credentials.uses import CredentialUse
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


def binding_not_signed_refusal() -> PersonalCredentialRefused:
    """A connection asks for each person's own account, and its run carries no signed
    binding for it (a run started outside the API). Never the shared account."""
    return PersonalCredentialRefused(
        code="binding_not_signed",
        message=(
            "This agent uses each person's own account. Start it from a conversation "
            "in Agenta."
        ),
    )


def account_missing_refusal(*, label: str) -> PersonalCredentialRefused:
    return PersonalCredentialRefused(
        code="personal_account_missing",
        message=f"Connect your {label} account to use this agent.",
    )


def shared_session_refusal(*, label: str) -> PersonalCredentialRefused:
    return PersonalCredentialRefused(
        code="shared_session",
        message=(
            f"This conversation is shared. {label} is set to use each person's own "
            "account, which shared conversations cannot use."
        ),
    )


def no_private_conversation_refusal(*, label: str) -> PersonalCredentialRefused:
    return PersonalCredentialRefused(
        code="no_private_conversation",
        message=(
            f"{label} is set to use each person's own account, which works only in "
            "a private conversation."
        ),
    )


# The shared-session guard (M7, design D6): `(project_id, session_id) -> allowed`. It
# locks the session row, refuses a shared session, and sets the sticky mark. The
# composition root installs the DAO's; without one, every run with a session is refused.
PersonalUseGuard = Callable[..., Awaitable[bool]]
_guard: Optional[PersonalUseGuard] = None

# Sessions this pod already marked. The mark never clears and a marked session can never
# be shared, so a hit needs no lock and no round trip.
_MARKED_LIMIT = 10_000
_marked: "OrderedDict[Tuple[UUID, str], None]" = OrderedDict()


def set_personal_use_guard(guard: Optional[PersonalUseGuard]) -> None:
    global _guard
    _guard = guard
    _marked.clear()


async def _check_session(
    *, authority: RunAuthority, session_id: Optional[str], label: str
) -> None:
    # A channel turn uses the linked person's own account (owner decision, 2026-10-28),
    # although its session is the channel's. The guard would refuse every one of them.
    if authority.principal.kind == PrincipalKind.INSTALLATION:
        return
    key = (authority.project_id, session_id)
    if key in _marked:
        return
    if _guard is None or not await _guard(
        project_id=authority.project_id, session_id=session_id
    ):
        raise shared_session_refusal(label=label)
    _marked[key] = None
    if len(_marked) > _MARKED_LIMIT:
        _marked.popitem(last=False)


# Records which person's own account a run used (design D8). The composition root
# installs the DAO's; without one nothing is recorded. Each pod remembers what it
# recorded, so a run's later calls on the same connection add no write.
UseRecorder = Callable[..., Awaitable[None]]
_recorder: Optional[UseRecorder] = None
_RECORDED_LIMIT = 10_000
_recorded: "OrderedDict[Tuple[UUID, str, str], None]" = OrderedDict()


def set_use_recorder(recorder: Optional[UseRecorder]) -> None:
    global _recorder
    _recorder = recorder
    _recorded.clear()


async def _record_use(
    *,
    authority: RunAuthority,
    session_id: Optional[str],
    run_id: Optional[str],
    key: Optional[ConnectionKey],
    owner_id: UUID,
    found: Any,
) -> None:
    if _recorder is None or key is None or not run_id or not session_id:
        return
    connection_key = f"{key.kind}:{key.service}"
    marker = (authority.project_id, run_id, connection_key)
    if marker in _recorded:
        return
    credential_id = getattr(found, "id", None)
    if credential_id is None:
        return
    name = getattr(found, "name", None) or getattr(
        getattr(found, "header", None), "name", None
    )
    await _recorder(
        project_id=authority.project_id,
        use=CredentialUse(
            session_id=session_id,
            run_id=run_id,
            connection_key=connection_key,
            binding=Binding.CALLER_ACCOUNT.value,
            owner_kind="user",
            owner_id=owner_id,
            credential_id=credential_id,
            credential_name=name,
        ),
    )
    _recorded[marker] = None
    if len(_recorded) > _RECORDED_LIMIT:
        _recorded.popitem(last=False)


async def select_personal_credential(
    *,
    authority: Optional[RunAuthority],
    label: str,
    read: Callable[[UUID], Awaitable[Optional[T]]],
    session_id: Optional[str] = None,
    key: Optional[ConnectionKey] = None,
    run_id: Optional[str] = None,
) -> T:
    """The credential `read` finds for the person the run acts for.

    `label` is the service's display name, for the refusal; `session_id` is the run's
    signed session. Before the credential is returned, a session that is shared refuses
    it, and a private one gets the sticky mark that keeps it private. Raises
    `PersonalCredentialRefused`; never returns another account."""

    caller = caller_user_id(authority)
    if authority is None or caller is None:
        raise no_caller_refusal(authority=authority, label=label)
    # A run with no conversation (an evaluation, a direct API call, a child of a run
    # that named none) leaves its output in traces the whole project reads. It is not
    # a private conversation, so it is refused before anything is read. A channel turn
    # uses the linked person's account by owner decision.
    if session_id is None and authority.principal.kind != PrincipalKind.INSTALLATION:
        raise no_private_conversation_refusal(label=label)
    await check_personal_credentials_allowed(organization_id=authority.organization_id)
    found = await read(caller)
    if found is None:
        raise account_missing_refusal(label=label)
    await _check_session(authority=authority, session_id=session_id, label=label)
    await _record_use(
        authority=authority,
        session_id=session_id,
        run_id=run_id,
        key=key,
        owner_id=caller,
        found=found,
    )
    return found


def run_id_of(access: Any) -> Optional[str]:
    """The runner turn a run credential names, when it names one."""
    envelope = getattr(access, "envelope", None)
    return envelope.context.run_id if envelope is not None else None
