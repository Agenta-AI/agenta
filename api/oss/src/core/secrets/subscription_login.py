"""The API to runner hop that drives a subscription device login.

The runner owns the OAuth exchange: it holds the harness client that talks to the provider,
and it is the only process that ever sees the device code secret half. The API relays the
user code and the verification address, and stores the credential the runner hands back.

Same base URL and shared-secret token the other direct hops use
(`oss/src/core/sessions/streams/runner_client.py`).
"""

from typing import Any, Dict, Optional

import httpx
from pydantic import BaseModel, ConfigDict

from oss.src.core.secrets.types import (
    SubscriptionLoginAttemptNotFound,
    SubscriptionLoginRunnerNotConfigured,
    SubscriptionLoginRunnerUnavailable,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

_START_TIMEOUT_SECONDS = 15.0
_POLL_TIMEOUT_SECONDS = 15.0
_DELETE_TIMEOUT_SECONDS = 5.0

# The floor the contract puts under the runner's own poll interval.
_MIN_POLL_AFTER_MS = 2000


class RunnerLoginAttempt(BaseModel):
    """One device login attempt as the runner reports it.

    `login` is present at most once, on the first read that finds the attempt succeeded.
    """

    model_config = ConfigDict(extra="ignore")

    attempt_id: str
    state: str
    user_code: Optional[str] = None
    verification_uri: Optional[str] = None
    expires_at: Optional[str] = None
    poll_after_ms: int = _MIN_POLL_AFTER_MS
    login: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


def _parse_attempt(payload: Any, *, fallback_attempt_id: str) -> RunnerLoginAttempt:
    if not isinstance(payload, dict):
        raise SubscriptionLoginRunnerUnavailable(
            message="The agent runner answered the sign-in with an unreadable body."
        )

    interval_seconds = payload.get("intervalSeconds")
    poll_after_ms = _MIN_POLL_AFTER_MS
    if isinstance(interval_seconds, (int, float)) and interval_seconds > 0:
        poll_after_ms = max(_MIN_POLL_AFTER_MS, int(interval_seconds * 1000))

    login = payload.get("login")

    return RunnerLoginAttempt(
        attempt_id=str(payload.get("attemptId") or fallback_attempt_id),
        state=str(payload.get("state") or "pending"),
        user_code=payload.get("userCode"),
        verification_uri=payload.get("verificationUri"),
        expires_at=payload.get("expiresAt"),
        poll_after_ms=poll_after_ms,
        login=login if isinstance(login, dict) else None,
        error=payload.get("error"),
    )


class SubscriptionLoginRunnerClient:
    """HTTP client for the runner's `/subscription-login` routes."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
    ) -> None:
        self._base_url = base_url if base_url is not None else env.runner.internal_url
        self._token = token if token is not None else env.runner.token

    @property
    def configured(self) -> bool:
        return bool(self._base_url) and bool(self._token)

    def _url(self, path: str) -> str:
        if not self.configured:
            raise SubscriptionLoginRunnerNotConfigured()
        return str(self._base_url).rstrip("/") + path

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"}

    async def start_attempt(self, *, provider: str) -> RunnerLoginAttempt:
        url = self._url("/subscription-login/attempts")
        try:
            async with httpx.AsyncClient(timeout=_START_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    url,
                    json={"provider": provider},
                    headers=self._headers(),
                )
        except httpx.HTTPError as e:
            log.warning("subscription login: runner start failed: %s", e)
            raise SubscriptionLoginRunnerUnavailable() from e

        if response.status_code >= 300:
            log.warning(
                "subscription login: runner start returned %s",
                response.status_code,
            )
            raise SubscriptionLoginRunnerUnavailable(
                message=(
                    "The agent runner refused to start the sign-in "
                    f"(status {response.status_code})."
                )
            )

        return _parse_attempt(_json_body(response), fallback_attempt_id="")

    async def read_attempt(self, *, attempt_id: str) -> RunnerLoginAttempt:
        url = self._url(f"/subscription-login/attempts/{attempt_id}")
        try:
            async with httpx.AsyncClient(timeout=_POLL_TIMEOUT_SECONDS) as client:
                response = await client.get(url, headers=self._headers())
        except httpx.HTTPError as e:
            log.warning("subscription login: runner poll failed: %s", e)
            raise SubscriptionLoginRunnerUnavailable() from e

        if response.status_code == 404:
            raise SubscriptionLoginAttemptNotFound()

        if response.status_code >= 300:
            log.warning(
                "subscription login: runner poll returned %s",
                response.status_code,
            )
            raise SubscriptionLoginRunnerUnavailable(
                message=(
                    "The agent runner refused to report the sign-in "
                    f"(status {response.status_code})."
                )
            )

        return _parse_attempt(_json_body(response), fallback_attempt_id=attempt_id)

    async def delete_attempt(self, *, attempt_id: str) -> bool:
        """Purge an attempt on the runner. Never raises: the row is the source of truth."""
        if not self.configured:
            return False

        url = (
            str(self._base_url).rstrip("/")
            + f"/subscription-login/attempts/{attempt_id}"
        )
        try:
            async with httpx.AsyncClient(timeout=_DELETE_TIMEOUT_SECONDS) as client:
                response = await client.delete(url, headers=self._headers())
        except httpx.HTTPError as e:
            log.warning("subscription login: runner delete failed: %s", e)
            return False

        return response.status_code < 300 or response.status_code == 404


def _json_body(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError as e:
        raise SubscriptionLoginRunnerUnavailable(
            message="The agent runner answered the sign-in with an unreadable body."
        ) from e
