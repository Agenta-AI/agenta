"""Device login and login upkeep for a hosted subscription connection.

Three callers meet here. The browser starts, polls, and cancels a device login. The runner
pushes a refreshed login back after a turn. The runner also reports a login that stopped
working. All three edit the same subscription secret, so every decision that reads the
stored login is made against the locked row (`VaultService.update_secret_atomically`).
"""

from base64 import urlsafe_b64decode
from datetime import datetime, timezone
from enum import Enum
from json import loads as json_loads
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.secrets.dtos import (
    SecretResponseDTO,
    SubscriptionProviderDTO,
    UpdateSecretDTO,
    UpdateSecretPayloadDTO,
)
from oss.src.core.secrets.enums import SecretKind, SubscriptionLoginState
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import SubscriptionLoginRunnerClient
from oss.src.core.secrets.types import (
    SubscriptionLoginAttemptNotFound,
    SubscriptionSecretNotFound,
)
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

# States the runner reports that end an attempt.
_TERMINAL_FAILURE_STATES = {"failed", "expired", "cancelled"}

# A reason string comes from the runner and is shown to the user, so it is bounded.
_MAX_LOGIN_ERROR_LENGTH = 200

_ATTEMPT_NOT_FOUND_ERROR = "attempt not found; try again"

# The claim a Codex access token carries the ChatGPT account in. Pi reads the same one.
_ACCOUNT_CLAIM = "https://api.openai.com/auth"
_ACCOUNT_CLAIM_FIELD = "chatgpt_account_id"

_INVALID_LOGIN_REASON = "invalid_login"


class SubscriptionLoginAttemptView(BaseModel):
    """What a browser learns about an in-flight device login. Never the credential."""

    attempt_id: str
    state: str
    user_code: Optional[str] = None
    verification_uri: Optional[str] = None
    expires_at: Optional[str] = None
    poll_after_ms: Optional[int] = None
    error: Optional[str] = None


class SubscriptionLoginPushResult(BaseModel):
    version: int
    generation: int
    updated: bool
    stale: bool = False
    # The current login, sent back only when the run was on an older generation, so the
    # runner can rematerialize without a second call.
    login: Optional[Dict[str, Any]] = None
    # Why a push changed nothing, when the answer is worth acting on. Only the unusable
    # credential sets it; the ordering refusals are the runner working as designed.
    reason: Optional[str] = None


class SubscriptionLoginFailureResult(BaseModel):
    stale: bool
    version: int
    generation: int
    login: Optional[Dict[str, Any]] = None


class PushDecision(str, Enum):
    """What a pushed login is worth against the row it claims to refresh."""

    ACCEPT = "accept"
    # The same refresh token is already stored. Storing it again would bump the version
    # for nothing and, on two simultaneous polls, twice.
    NOOP = "noop"
    # The run carried an older lineage. It gets the current login back.
    STALE = "stale"
    # The credential itself is not usable, whatever lineage it claims.
    INVALID = "invalid"
    REJECT = "reject"


def _subscription_data(secret: SecretResponseDTO) -> SubscriptionProviderDTO:
    data = secret.data
    if not isinstance(data, SubscriptionProviderDTO):
        raise SubscriptionSecretNotFound()
    return data


def _update_with(
    secret: SecretResponseDTO,
    changes: Dict[str, Any],
) -> UpdateSecretDTO:
    """An update carrying the WHOLE stored payload plus `changes`.

    Every field is stated, so the keep-on-omit carry-over has nothing to fill in and an
    explicit clear (a finished attempt, a cleared error) survives the write.
    """
    data = _subscription_data(secret).model_dump(mode="json")
    data.update(changes)

    return UpdateSecretDTO(
        secret=UpdateSecretPayloadDTO(
            kind=SecretKind.SUBSCRIPTION_PROVIDER,
            data=data,
        )
    )


def _attempt_is_live(expires_at: Optional[str]) -> bool:
    """True while a stored attempt can still be completed.

    An unreadable or missing deadline counts as expired: starting a fresh attempt costs
    the user one more click, while reusing a dead one leaves them polling forever.
    """
    if not expires_at:
        return False

    try:
        deadline = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError:
        return False

    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)

    return deadline > datetime.now(timezone.utc)


def _now_ms() -> int:
    """Now in epoch milliseconds, the unit a login's `expires` is written in."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _jwt_account_id(access: Any) -> Optional[str]:
    """The ChatGPT account a Codex access token was issued for, or None if it carries none.

    The signature is not checked. Only OpenAI can check it, and the platform is not the
    audience. What this does catch is a token that is not a JWT at all, which is what a
    harness leaves behind when its own refresh went wrong.
    """
    if not isinstance(access, str):
        return None

    segments = access.split(".")
    if len(segments) != 3:
        return None

    try:
        padded = segments[1] + "=" * (-len(segments[1]) % 4)
        payload = json_loads(urlsafe_b64decode(padded))
    except (ValueError, TypeError):
        return None

    if not isinstance(payload, dict):
        return None

    claim = payload.get(_ACCOUNT_CLAIM)
    if not isinstance(claim, dict):
        return None

    account_id = claim.get(_ACCOUNT_CLAIM_FIELD)
    if not isinstance(account_id, str) or not account_id:
        return None

    return account_id


def _login_is_usable(login: Dict[str, Any]) -> bool:
    """True when a login is a credential a run could actually authenticate with.

    Measured on 2026-09-08: an `auth.json` rewritten with junk `access` and `refresh` and
    a later `expires` was pushed and overwrote the good stored login. Every ordering rule
    below asks only whether a login is NEWER, and one number is all it takes to win that.

    The account comes from the token itself, never from what the file claims alongside it.
    The row is checked separately by the ordering rules, so an accepted login matches the
    token, the pushed `accountId`, and the stored `accountId`.

    This is not authentication. The signature is unchecked because the provider is the only
    authority on validity. It keeps garbage out of the vault, nothing more.

    These are the rules `validateSubscriptionLogin` in the runner applies before it pushes.
    Keep the two the same. A missing `accountId` is accepted here for the same reason it is
    accepted there: the field is optional in the credential shape, the claim is what names
    the account, and refusing on an absent optional field would refuse a real login.
    """
    claimed = _jwt_account_id(login.get("access"))
    if claimed is None:
        return False

    account_id = login.get("accountId")
    if isinstance(account_id, str) and account_id and account_id != claimed:
        return False

    refresh = login.get("refresh")
    if not isinstance(refresh, str) or not refresh.strip():
        return False

    expires = login.get("expires")
    if isinstance(expires, bool) or not isinstance(expires, int):
        return False

    return expires > _now_ms()


def _attempt_matches(stored: SubscriptionProviderDTO, attempt_id: str) -> bool:
    """True when the locked row still waits on this attempt.

    Every write that finishes a device login asks this first. The check runs inside the
    row lock, so a poll that started before a cancel cannot act on the row the cancel and
    the replacement attempt left behind.
    """
    current = stored.login_attempt
    return current is not None and current.id == attempt_id


def _clip(reason: Optional[str]) -> Optional[str]:
    if reason is None:
        return None
    return reason[:_MAX_LOGIN_ERROR_LENGTH]


class SubscriptionLoginService:
    def __init__(
        self,
        *,
        vault_service: VaultService,
        runner_client: SubscriptionLoginRunnerClient,
    ) -> None:
        self.vault_service = vault_service
        self.runner_client = runner_client

    async def _load(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
    ) -> SecretResponseDTO:
        secret = await self.vault_service.get_secret_by_id(
            secret_id=secret_id,
            project_id=project_id,
        )
        if secret is None or secret.kind != SecretKind.SUBSCRIPTION_PROVIDER:
            raise SubscriptionSecretNotFound()
        return secret

    async def _apply(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        user_id: Optional[UUID],
        build_changes,
    ):
        """Run `build_changes(stored_data)` under the row lock and persist what it returns.

        `build_changes` returns a dict of subscription fields to write, or None to leave
        the row alone.
        """

        def resolve(stored: SecretResponseDTO) -> UpdateSecretDTO:
            changes = build_changes(_subscription_data(stored))
            if changes is None:
                # Header-less and secret-less: only the lifecycle columns move.
                return UpdateSecretDTO()
            return _update_with(stored, changes)

        return await self.vault_service.update_secret_atomically(
            secret_id=secret_id,
            project_id=project_id,
            user_id=user_id,
            resolve_update=resolve,
        )

    # -- browser-facing device login ------------------------------------------------

    async def start_attempt(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> SubscriptionLoginAttemptView:
        secret = await self._load(project_id=project_id, secret_id=secret_id)
        data = _subscription_data(secret)

        stored = data.login_attempt
        if stored is not None and _attempt_is_live(stored.expires_at):
            return SubscriptionLoginAttemptView(
                attempt_id=stored.id,
                state="pending",
                user_code=stored.user_code,
                verification_uri=stored.verification_uri,
                expires_at=stored.expires_at,
                poll_after_ms=stored.poll_after_ms,
            )

        attempt = await self.runner_client.start_attempt(
            provider=data.provider.value,
        )

        await self._apply(
            project_id=project_id,
            secret_id=secret_id,
            user_id=user_id,
            build_changes=lambda _stored: {
                "login_attempt": {
                    "id": attempt.attempt_id,
                    "expires_at": attempt.expires_at,
                    "user_code": attempt.user_code,
                    "verification_uri": attempt.verification_uri,
                    "poll_after_ms": attempt.poll_after_ms,
                },
                "login_error": None,
            },
        )

        return SubscriptionLoginAttemptView(
            attempt_id=attempt.attempt_id,
            state="pending",
            user_code=attempt.user_code,
            verification_uri=attempt.verification_uri,
            expires_at=attempt.expires_at,
            poll_after_ms=attempt.poll_after_ms,
        )

    async def read_attempt(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        attempt_id: str,
        user_id: Optional[UUID] = None,
    ) -> SubscriptionLoginAttemptView:
        """Ask the runner where the attempt stands, and store a login it hands back.

        The attempt id must be the one this connection is waiting on. That binding is the
        only thing stopping one project from redeeming another project's device login.
        """
        secret = await self._load(project_id=project_id, secret_id=secret_id)
        data = _subscription_data(secret)

        if data.login_attempt is None or data.login_attempt.id != attempt_id:
            raise SubscriptionLoginAttemptNotFound()

        try:
            attempt = await self.runner_client.read_attempt(attempt_id=attempt_id)
        except SubscriptionLoginAttemptNotFound:
            # Attempts live in one runner process. Behind several replicas a poll can reach
            # a replica that never held this attempt, and it answers 404 like a real
            # expiry. Both cases end the attempt and the user starts a new one.
            await self._clear_attempt(
                project_id=project_id,
                secret_id=secret_id,
                user_id=user_id,
                attempt_id=attempt_id,
                error=_ATTEMPT_NOT_FOUND_ERROR,
            )
            return SubscriptionLoginAttemptView(
                attempt_id=attempt_id,
                state="failed",
                error=_ATTEMPT_NOT_FOUND_ERROR,
            )

        if attempt.state == "succeeded":
            if attempt.login and not _login_is_usable(attempt.login):
                # The device flow finished but handed back something no run can
                # authenticate with. Ending the attempt beats storing it and leaving every
                # later run to fail on a credential the user cannot see is broken.
                log.warning(
                    "[subscriptions] refused an unusable device login",
                    project_id=str(project_id),
                    secret_id=str(secret_id),
                )
                await self.runner_client.delete_attempt(attempt_id=attempt_id)
                await self._clear_attempt(
                    project_id=project_id,
                    secret_id=secret_id,
                    user_id=user_id,
                    attempt_id=attempt_id,
                    error=_INVALID_LOGIN_REASON,
                )
                return SubscriptionLoginAttemptView(
                    attempt_id=attempt.attempt_id or attempt_id,
                    state="failed",
                    error=_INVALID_LOGIN_REASON,
                )

            if attempt.login:
                await self._store_new_login(
                    project_id=project_id,
                    secret_id=secret_id,
                    user_id=user_id,
                    attempt_id=attempt_id,
                    login=attempt.login,
                )
                await self.runner_client.delete_attempt(attempt_id=attempt_id)
            else:
                await self._clear_attempt(
                    project_id=project_id,
                    secret_id=secret_id,
                    user_id=user_id,
                    attempt_id=attempt_id,
                    error=None,
                )
            return SubscriptionLoginAttemptView(
                attempt_id=attempt.attempt_id or attempt_id,
                state="succeeded",
            )

        if attempt.state in _TERMINAL_FAILURE_STATES:
            await self._clear_attempt(
                project_id=project_id,
                secret_id=secret_id,
                user_id=user_id,
                attempt_id=attempt_id,
                error=attempt.error,
            )
            return SubscriptionLoginAttemptView(
                attempt_id=attempt.attempt_id or attempt_id,
                state=attempt.state,
                error=attempt.error,
            )

        await self._refresh_pending_attempt(
            project_id=project_id,
            secret_id=secret_id,
            user_id=user_id,
            attempt_id=attempt_id,
            expires_at=attempt.expires_at,
            user_code=attempt.user_code,
            verification_uri=attempt.verification_uri,
            poll_after_ms=attempt.poll_after_ms,
        )

        return SubscriptionLoginAttemptView(
            attempt_id=attempt_id,
            state="pending",
            user_code=attempt.user_code or data.login_attempt.user_code,
            verification_uri=(
                attempt.verification_uri or data.login_attempt.verification_uri
            ),
            expires_at=attempt.expires_at or data.login_attempt.expires_at,
            poll_after_ms=attempt.poll_after_ms,
        )

    async def cancel_attempt(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        attempt_id: str,
        user_id: Optional[UUID] = None,
    ) -> SubscriptionLoginAttemptView:
        secret = await self._load(project_id=project_id, secret_id=secret_id)
        data = _subscription_data(secret)

        if data.login_attempt is None or data.login_attempt.id != attempt_id:
            raise SubscriptionLoginAttemptNotFound()

        await self.runner_client.delete_attempt(attempt_id=attempt_id)
        await self._clear_attempt(
            project_id=project_id,
            secret_id=secret_id,
            user_id=user_id,
            attempt_id=attempt_id,
            error=None,
        )

        return SubscriptionLoginAttemptView(
            attempt_id=attempt_id,
            state="cancelled",
        )

    # -- runner-facing login upkeep --------------------------------------------------

    async def push_login(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        login: Dict[str, Any],
        version: int,
        generation: int,
    ) -> SubscriptionLoginPushResult:
        """Store a login a run refreshed, but only when it belongs on this row.

        A pushed login never bumps the generation: a refresh keeps warm sessions, only a
        new device login makes them start cold.
        """
        secret = await self._load(project_id=project_id, secret_id=secret_id)
        data = _subscription_data(secret)

        # Most turns push a login the row already holds, so answer those without a write.
        decision = _classify_push(stored=data, login=login, generation=generation)
        if decision is PushDecision.INVALID:
            log.warning(
                "[subscriptions] refused an unusable pushed login",
                project_id=str(project_id),
                secret_id=str(secret_id),
            )
        if decision is not PushDecision.ACCEPT:
            return _push_result(stored=data, decision=decision)

        result: Dict[str, Any] = {}

        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            # Re-decided against the locked row: another replica may have pushed the same
            # refresh token, or a newer generation, since the read above.
            locked = _classify_push(stored=stored, login=login, generation=generation)
            if locked is not PushDecision.ACCEPT:
                result.update(_push_result(stored=stored, decision=locked).model_dump())
                return None

            result.update(
                {
                    "version": stored.login_version + 1,
                    "generation": stored.login_generation,
                    "updated": True,
                    "stale": False,
                    "login": None,
                }
            )
            return {
                "login": login,
                "login_version": stored.login_version + 1,
                "login_state": SubscriptionLoginState.READY.value,
                "login_error": None,
            }

        await self._apply(
            project_id=project_id,
            secret_id=secret_id,
            user_id=None,
            build_changes=build_changes,
        )

        return SubscriptionLoginPushResult(**result)

    async def report_login_failure(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        version: int,
        generation: int,
        reason: str,
    ) -> SubscriptionLoginFailureResult:
        """Mark the stored login unusable, unless the run was using an older one.

        A stale answer carries the current login so the runner can rematerialize and retry
        the turn in one hop, which is the whole point of reporting the failure first.
        """
        secret = await self._load(project_id=project_id, secret_id=secret_id)
        data = _subscription_data(secret)

        if _failure_is_stale(stored=data, version=version, generation=generation):
            return _stale_failure_result(stored=data)

        result: Dict[str, Any] = {}

        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            if _failure_is_stale(stored=stored, version=version, generation=generation):
                result.update(_stale_failure_result(stored=stored).model_dump())
                return None

            result.update(
                {
                    "stale": False,
                    "version": stored.login_version,
                    "generation": stored.login_generation,
                    "login": None,
                }
            )
            return {
                "login_state": SubscriptionLoginState.NEEDS_LOGIN.value,
                "login_error": _clip(reason),
            }

        await self._apply(
            project_id=project_id,
            secret_id=secret_id,
            user_id=None,
            build_changes=build_changes,
        )

        return SubscriptionLoginFailureResult(**result)

    # -- writes -----------------------------------------------------------------------

    async def _store_new_login(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        user_id: Optional[UUID],
        attempt_id: str,
        login: Dict[str, Any],
    ) -> None:
        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            # The attempt id decides. A poll can still be in flight when the user cancels
            # and starts another login, and the runner keeps returning the login on every
            # poll until the API deletes the attempt. Both cases land here on a row that
            # waits on a different attempt, or on none, and neither may install a login.
            if not _attempt_matches(stored, attempt_id):
                return None

            # A second guard, for a replayed poll of the attempt the row still holds. The
            # refresh token is the identity of a login: seeing the stored one again means
            # the write already happened, and a second bump would push every warm session
            # cold for nothing.
            if stored.login is not None and stored.login.refresh == login.get(
                "refresh"
            ):
                return None

            return {
                "login": login,
                "login_version": stored.login_version + 1,
                "login_generation": stored.login_generation + 1,
                "login_state": SubscriptionLoginState.READY.value,
                "login_error": None,
                "login_attempt": None,
            }

        await self._apply(
            project_id=project_id,
            secret_id=secret_id,
            user_id=user_id,
            build_changes=build_changes,
        )

    async def _clear_attempt(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        user_id: Optional[UUID],
        attempt_id: str,
        error: Optional[str],
    ) -> None:
        """Clear the attempt, but only while the row still waits on this one.

        A late answer about an abandoned attempt must not clear the replacement the user
        already started, and must not report its error against the new login.
        """

        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            if not _attempt_matches(stored, attempt_id):
                return None

            return {
                "login_attempt": None,
                "login_error": _clip(error),
            }

        await self._apply(
            project_id=project_id,
            secret_id=secret_id,
            user_id=user_id,
            build_changes=build_changes,
        )

    async def _refresh_pending_attempt(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        user_id: Optional[UUID],
        attempt_id: str,
        expires_at: Optional[str],
        user_code: Optional[str],
        verification_uri: Optional[str],
        poll_after_ms: Optional[int],
    ) -> None:
        """Write the attempt back only when the runner reported something different.

        A poll runs every couple of seconds for up to fifteen minutes; without this guard
        each one would be a row write.
        """

        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            if not _attempt_matches(stored, attempt_id):
                return None

            current = stored.login_attempt
            fresh = {
                "id": attempt_id,
                "expires_at": expires_at or current.expires_at,
                "user_code": user_code or current.user_code,
                "verification_uri": verification_uri or current.verification_uri,
                "poll_after_ms": poll_after_ms or current.poll_after_ms,
            }
            if fresh == current.model_dump(mode="json"):
                return None

            return {"login_attempt": fresh}

        await self._apply(
            project_id=project_id,
            secret_id=secret_id,
            user_id=user_id,
            build_changes=build_changes,
        )


def _classify_push(
    *,
    stored: SubscriptionProviderDTO,
    login: Dict[str, Any],
    generation: int,
) -> PushDecision:
    """Decide what a pushed login is worth, in the order the contract fixes.

    Shape first, because the ordering rules all assume a real credential: a garbage string
    with a later expiry outranks a working login under every one of them. Then generation,
    because a login from an older lineage is not a competitor: the run is behind and needs
    the current one back. Then the account, so a login for a different ChatGPT account can
    never take over the connection. Then the refresh token, which is what makes the store
    idempotent when two polls redeem the same device login. Expiry last: an equal expiry
    with a new refresh token is still a real refresh.
    """
    if stored.login is None:
        return PushDecision.REJECT

    if not _login_is_usable(login):
        return PushDecision.INVALID

    if generation < stored.login_generation:
        return PushDecision.STALE

    if generation != stored.login_generation:
        # The run claims a lineage this row has never issued. Nothing safe to do with it.
        return PushDecision.REJECT

    if login.get("accountId") != stored.login.accountId:
        return PushDecision.REJECT

    if login.get("refresh") == stored.login.refresh:
        return PushDecision.NOOP

    expires = login.get("expires")
    if not isinstance(expires, int) or expires < (stored.login.expires or 0):
        return PushDecision.REJECT

    return PushDecision.ACCEPT


def _push_result(
    *,
    stored: SubscriptionProviderDTO,
    decision: PushDecision,
) -> SubscriptionLoginPushResult:
    return SubscriptionLoginPushResult(
        version=stored.login_version,
        generation=stored.login_generation,
        updated=False,
        stale=decision is PushDecision.STALE,
        login=_current_login(stored) if decision is PushDecision.STALE else None,
        reason=(_INVALID_LOGIN_REASON if decision is PushDecision.INVALID else None),
    )


def _failure_is_stale(
    *,
    stored: SubscriptionProviderDTO,
    version: int,
    generation: int,
) -> bool:
    """True when the row moved on since the run was given its login."""
    return stored.login_generation > generation or stored.login_version > version


def _stale_failure_result(
    *,
    stored: SubscriptionProviderDTO,
) -> SubscriptionLoginFailureResult:
    return SubscriptionLoginFailureResult(
        stale=True,
        version=stored.login_version,
        generation=stored.login_generation,
        login=_current_login(stored),
    )


def _current_login(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
    return stored.login.model_dump(mode="json") if stored.login else None
