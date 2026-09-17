"""Device login and login upkeep for a hosted subscription connection.

Three callers meet here. The browser starts, polls, and cancels a device login. The runner
pushes a refreshed login back after a turn, and reports a login that stopped working. All
three edit the same subscription secret, so every decision that reads the stored login is
made against the locked row (`VaultService.update_secret_atomically`).
"""

from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.secrets.dtos import (
    SecretResponseDTO,
    SubscriptionLoginAttemptDTO,
    SubscriptionProviderDTO,
    UpdateSecretDTO,
    UpdateSecretPayloadDTO,
)
from oss.src.core.secrets.enums import SecretKind, SubscriptionLoginState
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import (
    RunnerLoginAttempt,
    SubscriptionLoginRunnerClient,
)
from oss.src.core.secrets.subscription_rules import (
    PushDecision,
    attempt_is_live,
    classify_push,
    failure_is_stale,
    login_is_usable,
    push_reason,
)
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

_INVALID_LOGIN_REASON = "invalid_login"

# Push decisions worth a warning rather than an info line.
_WARNED_PUSH_DECISIONS = {PushDecision.INVALID, PushDecision.OTHER_ACCOUNT}


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
    # The current login, sent back only on a stale answer, so the runner can rematerialize
    # without a second call.
    login: Optional[Dict[str, Any]] = None
    # Why a push was not stored, as a stable slug. `same_login` means the row already holds
    # this exact credential, which is the one refusal that still tells the runner its
    # credential is current; every other slug (`invalid_login`, `older_login`,
    # `other_account`, `wrong_generation`, `no_login`) means the row kept something else.
    # An accepted push and a stale answer carry none: `updated` and `stale` say it.
    reason: Optional[str] = None


class SubscriptionLoginFailureResult(BaseModel):
    stale: bool
    version: int
    generation: int
    login: Optional[Dict[str, Any]] = None


def _log_attempt(
    secret_id: UUID,
    attempt_id: str,
    state: str,
    outcome: str,
    *,
    warn: bool = False,
) -> None:
    """One line per attempt decision. Never the user code, never the credential.

    `connection` is the key the runner uses for the same id, so one query follows a sign-in
    across the hop.
    """
    write = log.warning if warn else log.info
    write(
        "subscription.attempt",
        connection=str(secret_id),
        attempt_id=attempt_id,
        state=state,
        outcome=outcome,
    )


def _log_push(
    secret_id: UUID,
    stored: SubscriptionProviderDTO,
    generation: int,
    decision: PushDecision,
) -> None:
    """One line per push decision. Never the credential.

    Two decisions warn, because both mean a run pushed something that cannot belong here: an
    unusable credential, and a login for another ChatGPT account. The ordering refusals are
    the protocol working, so they stay at info.
    """
    write = log.warning if decision in _WARNED_PUSH_DECISIONS else log.info
    write(
        "subscription.push",
        connection=str(secret_id),
        incoming_generation=generation,
        stored_generation=stored.login_generation,
        stored_version=stored.login_version,
        decision=decision.value,
    )


def _log_failure(
    secret_id: UUID,
    stored: SubscriptionProviderDTO,
    stale: bool,
    reason: str,
) -> None:
    log.info(
        "subscription.failure",
        connection=str(secret_id),
        stored_generation=stored.login_generation,
        stored_version=stored.login_version,
        stale=stale,
        reason=_clip(reason),
    )


def _subscription_data(secret: SecretResponseDTO) -> SubscriptionProviderDTO:
    data = secret.data
    if not isinstance(data, SubscriptionProviderDTO):
        raise SubscriptionSecretNotFound()
    return data


def _update_with(secret: SecretResponseDTO, changes: Dict[str, Any]) -> UpdateSecretDTO:
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


def _attempt_matches(stored: SubscriptionProviderDTO, attempt_id: str) -> bool:
    """True when the locked row still waits on this attempt.

    Every write that finishes a device login asks this first, inside the row lock, so a
    poll that started before a cancel cannot act on the row the replacement attempt left.
    """
    current = stored.login_attempt
    return current is not None and current.id == attempt_id


def _clip(reason: Optional[str]) -> Optional[str]:
    if reason is None:
        return None
    return reason[:_MAX_LOGIN_ERROR_LENGTH]


def _stored_attempt(attempt: RunnerLoginAttempt) -> Dict[str, Any]:
    """The device-code metadata the row keeps, so any API replica can serve a reload."""
    return {
        "id": attempt.attempt_id,
        "expires_at": attempt.expires_at,
        "user_code": attempt.user_code,
        "verification_uri": attempt.verification_uri,
        "poll_after_ms": attempt.poll_after_ms,
    }


def _pending_view(stored: SubscriptionLoginAttemptDTO) -> SubscriptionLoginAttemptView:
    return SubscriptionLoginAttemptView(
        attempt_id=stored.id,
        state="pending",
        user_code=stored.user_code,
        verification_uri=stored.verification_uri,
        expires_at=stored.expires_at,
        poll_after_ms=stored.poll_after_ms,
    )


class SubscriptionLoginService:
    def __init__(
        self,
        *,
        vault_service: VaultService,
        runner_client: SubscriptionLoginRunnerClient,
    ) -> None:
        self.vault_service = vault_service
        self.runner_client = runner_client

    async def _load(self, *, project_id: UUID, secret_id: UUID) -> SecretResponseDTO:
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

        `build_changes` returns the subscription fields to write, or None to leave the row
        alone. None writes nothing at all: no lifecycle column moves, no commit, and the
        project's vault cache keeps its entry.

        A row that is gone by the time the lock is taken raises, because `build_changes`
        never runs and every caller reads its own result out of what that callback set. The
        row can disappear between the load and the write: a user disconnects the connection
        while a run is pushing. Answering 404 beats validating an empty push result into a
        500, and beats reporting a device login as stored when nothing was written.
        """

        def resolve(stored: SecretResponseDTO) -> Optional[UpdateSecretDTO]:
            changes = build_changes(_subscription_data(stored))
            return None if changes is None else _update_with(stored, changes)

        secret = await self.vault_service.update_secret_atomically(
            secret_id=secret_id,
            project_id=project_id,
            user_id=user_id,
            resolve_update=resolve,
        )

        if secret is None:
            raise SubscriptionSecretNotFound()

        return secret

    # -- browser-facing device login ------------------------------------------------

    async def start_attempt(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> SubscriptionLoginAttemptView:
        """Start a device login, or hand back the one this connection already waits on.

        One connection holds one attempt. Two tabs that start together both reach the
        runner, and the locked row decides which code is redeemable. The loser's attempt
        is cancelled and both callers get the winner, so no browser is left showing a code
        that can never complete.
        """
        secret = await self._load(project_id=project_id, secret_id=secret_id)
        data = _subscription_data(secret)

        stored = data.login_attempt
        if stored is not None and attempt_is_live(stored.expires_at):
            _log_attempt(secret_id, stored.id, "pending", "reused")
            return _pending_view(stored)

        attempt = await self.runner_client.start_attempt(provider=data.provider.value)

        retained: Dict[str, SubscriptionLoginAttemptDTO] = {}

        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            live = stored.login_attempt
            if (
                live is not None
                and live.id != attempt.attempt_id
                and attempt_is_live(live.expires_at)
            ):
                retained["attempt"] = live
                return None

            # `login_error` is not touched here. It says why the stored login stopped
            # working, and starting a sign-in does not answer that: an attempt the user
            # abandons leaves the row exactly as the failed run left it. The login that
            # lands clears it.
            return {"login_attempt": _stored_attempt(attempt)}

        await self._apply(
            project_id=project_id,
            secret_id=secret_id,
            user_id=user_id,
            build_changes=build_changes,
        )

        winner = retained.get("attempt")
        if winner is not None:
            await self.runner_client.delete_attempt(attempt_id=attempt.attempt_id)
            _log_attempt(secret_id, winner.id, "pending", "reused")
            _log_attempt(secret_id, attempt.attempt_id, "cancelled", "superseded")
            return _pending_view(winner)

        _log_attempt(secret_id, attempt.attempt_id, "pending", "started")
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

        The attempt id must be the one this connection waits on. That binding is the only
        thing stopping one project from redeeming another project's device login.

        A poll that finds the attempt still pending writes nothing: the device code and
        its deadline were stored when the attempt started and never change.
        """
        secret = await self._load(project_id=project_id, secret_id=secret_id)
        data = _subscription_data(secret)

        if data.login_attempt is None or data.login_attempt.id != attempt_id:
            raise SubscriptionLoginAttemptNotFound()

        try:
            attempt = await self.runner_client.read_attempt(attempt_id=attempt_id)
        except SubscriptionLoginAttemptNotFound:
            # Attempts live in one runner process. Behind several replicas a poll can
            # reach a replica that never held this attempt, and it answers 404 like a real
            # expiry. Both cases end the attempt and the user starts a new one.
            await self._clear_attempt(
                project_id=project_id,
                secret_id=secret_id,
                user_id=user_id,
                attempt_id=attempt_id,
            )
            _log_attempt(secret_id, attempt_id, "failed", "not_found")
            return SubscriptionLoginAttemptView(
                attempt_id=attempt_id,
                state="failed",
                error=_ATTEMPT_NOT_FOUND_ERROR,
            )

        if attempt.state == "succeeded":
            return await self._settle_attempt(
                project_id=project_id,
                secret_id=secret_id,
                user_id=user_id,
                attempt_id=attempt_id,
                attempt=attempt,
            )

        if attempt.state in _TERMINAL_FAILURE_STATES:
            await self._clear_attempt(
                project_id=project_id,
                secret_id=secret_id,
                user_id=user_id,
                attempt_id=attempt_id,
            )
            _log_attempt(secret_id, attempt_id, attempt.state, "ended")
            return SubscriptionLoginAttemptView(
                attempt_id=attempt.attempt_id or attempt_id,
                state=attempt.state,
                error=attempt.error,
            )

        return _pending_view(data.login_attempt)

    async def _settle_attempt(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        user_id: Optional[UUID],
        attempt_id: str,
        attempt: RunnerLoginAttempt,
    ) -> SubscriptionLoginAttemptView:
        """Finish a succeeded attempt: store the login, or refuse an unusable one."""
        if attempt.login and not login_is_usable(attempt.login):
            # The device flow finished but handed back something no run can authenticate
            # with. Ending the attempt beats storing it and leaving every later run to
            # fail on a credential the user cannot see is broken.
            await self.runner_client.delete_attempt(attempt_id=attempt_id)
            await self._clear_attempt(
                project_id=project_id,
                secret_id=secret_id,
                user_id=user_id,
                attempt_id=attempt_id,
            )
            _log_attempt(secret_id, attempt_id, "failed", "unusable_login", warn=True)
            return SubscriptionLoginAttemptView(
                attempt_id=attempt.attempt_id or attempt_id,
                state="failed",
                error=_INVALID_LOGIN_REASON,
            )

        if attempt.login:
            installed = await self._store_new_login(
                project_id=project_id,
                secret_id=secret_id,
                user_id=user_id,
                attempt_id=attempt_id,
                login=attempt.login,
            )
            if not installed:
                # The row moved to another attempt while this poll was in flight: the user
                # cancelled and started again. Nothing was written, so this poll answers the
                # way a poll of an attempt the row never held answers, and the browser
                # reconciles against the connection instead of showing a sign-in that did
                # not happen.
                _log_attempt(secret_id, attempt_id, "failed", "superseded")
                raise SubscriptionLoginAttemptNotFound()

            await self.runner_client.delete_attempt(attempt_id=attempt_id)
        else:
            await self._clear_attempt(
                project_id=project_id,
                secret_id=secret_id,
                user_id=user_id,
                attempt_id=attempt_id,
            )

        outcome = "stored" if attempt.login else "already_stored"
        _log_attempt(secret_id, attempt_id, "succeeded", outcome)
        return SubscriptionLoginAttemptView(
            attempt_id=attempt.attempt_id or attempt_id,
            state="succeeded",
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
        )

        _log_attempt(secret_id, attempt_id, "cancelled", "ended")
        return SubscriptionLoginAttemptView(attempt_id=attempt_id, state="cancelled")

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
        decision = classify_push(stored=data, login=login, generation=generation)
        if decision is not PushDecision.ACCEPT:
            _log_push(secret_id, data, generation, decision)
            return _push_result(stored=data, decision=decision)

        result: Dict[str, Any] = {}

        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            # Re-decided against the locked row: another replica may have pushed the same
            # refresh token, or a newer generation, since the read above.
            locked = classify_push(stored=stored, login=login, generation=generation)
            _log_push(secret_id, stored, generation, locked)
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

        if failure_is_stale(stored=data, version=version, generation=generation):
            _log_failure(secret_id, data, True, reason)
            return _stale_failure_result(stored=data)

        result: Dict[str, Any] = {}

        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            stale = failure_is_stale(
                stored=stored, version=version, generation=generation
            )
            _log_failure(secret_id, stored, stale, reason)
            if stale:
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
    ) -> bool:
        """Store the login, and answer whether the row still belongs to this attempt.

        False means the binding moved, so nothing was written and the caller must not report
        a sign-in. True covers the replayed poll too: the row already holds this login, which
        is the write having happened rather than a refusal.
        """
        bound = True

        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            nonlocal bound

            # A poll can still be in flight when the user cancels and starts another
            # login, and the runner keeps returning the login on every poll until the API
            # deletes the attempt. Both land here on a row waiting for a different
            # attempt, or none, and neither may install a login.
            if not _attempt_matches(stored, attempt_id):
                bound = False
                return None

            # A replayed poll of the attempt the row still holds. The refresh token is the
            # identity of a login: seeing the stored one again means the write already
            # happened, and a second bump would push every warm session cold for nothing.
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

        return bound

    async def _clear_attempt(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        user_id: Optional[UUID],
        attempt_id: str,
    ) -> None:
        """Clear the attempt, but only while the row still waits on this one.

        A late answer about an abandoned attempt must not clear the replacement the user
        already started.

        The attempt's own error stays on the attempt view and never reaches `login_error`.
        That field says why the STORED login stopped working, which is what the card turns
        into a sentence: writing `login_failed` over `refresh_rejected` would tell a user
        whose sign-in is dead that it merely needs renewing. Only the failure report writes
        it, and only a new login clears it.
        """

        def build_changes(stored: SubscriptionProviderDTO) -> Optional[Dict[str, Any]]:
            if not _attempt_matches(stored, attempt_id):
                return None

            return {"login_attempt": None}

        await self._apply(
            project_id=project_id,
            secret_id=secret_id,
            user_id=user_id,
            build_changes=build_changes,
        )


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
        reason=push_reason(decision),
    )


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
