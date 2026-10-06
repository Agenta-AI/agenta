"""The API to runner hop that drives a subscription device login.

The runner owns the OAuth exchange: it holds the harness client that talks to the provider,
and it is the only process that ever sees the device code secret half. The API relays the
user code and the verification address. The runner pod that runs the provider poll reports
the outcome back to the API on its own (`SubscriptionLoginService.report_attempt_outcome`),
so this client only starts and cancels.

Same Service URL and shared-secret token the other direct hops use
(`oss/src/core/sessions/streams/runner_client.py`).
"""

from typing import Any, Dict, Optional

import httpx
from pydantic import BaseModel, ConfigDict

from oss.src.core.secrets.types import (
    SubscriptionLoginRunnerNotConfigured,
    SubscriptionLoginRunnerUnavailable,
)
from oss.src.core.sessions.streams.runner_client import (
    RUNNER_ADDRESS_CONNECT_TIMEOUT_SECONDS,
    runner_address_is_replica,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

_START_TIMEOUT_SECONDS = 15.0
_DELETE_TIMEOUT_SECONDS = 5.0

# The floor the contract puts under the runner's own poll interval.
_MIN_POLL_AFTER_MS = 2000


def _log_hop(operation: str, outcome: str, **fields: Any) -> None:
    """One structured line per API to runner hop, in the vocabulary the row's decisions use.

    Same event name as the decisions this hop feeds (`subscription.attempt`), and key=value
    fields rather than a formatted sentence, so one query counts sign-in failures wherever
    they happened. The connection id is not known here: this client is addressed by attempt.
    """
    log.warning(
        "subscription.attempt",
        operation=operation,
        outcome=outcome,
        **fields,
    )


class RunnerLoginAttempt(BaseModel):
    """One device login attempt as the runner's start answer describes it."""

    model_config = ConfigDict(extra="ignore")

    attempt_id: str
    state: str
    user_code: Optional[str] = None
    verification_uri: Optional[str] = None
    expires_at: Optional[str] = None
    poll_after_ms: int = _MIN_POLL_AFTER_MS
    # The pod that runs the provider poll. None when the runner has no address of its own.
    runner_address: Optional[str] = None
    # That pod's replica id, checked against its `/health` before a cancel goes to the address.
    runner_replica_id: Optional[str] = None


def _nonblank(value: Any) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _parse_attempt(payload: Any, *, fallback_attempt_id: str) -> RunnerLoginAttempt:
    if not isinstance(payload, dict):
        raise SubscriptionLoginRunnerUnavailable(
            message="The agent runner answered the sign-in with an unreadable body."
        )

    interval_seconds = payload.get("intervalSeconds")
    poll_after_ms = _MIN_POLL_AFTER_MS
    if isinstance(interval_seconds, (int, float)) and interval_seconds > 0:
        poll_after_ms = max(_MIN_POLL_AFTER_MS, int(interval_seconds * 1000))

    return RunnerLoginAttempt(
        attempt_id=str(payload.get("attemptId") or fallback_attempt_id),
        state=str(payload.get("state") or "pending"),
        user_code=payload.get("userCode"),
        verification_uri=payload.get("verificationUri"),
        expires_at=payload.get("expiresAt"),
        poll_after_ms=poll_after_ms,
        runner_address=_nonblank(payload.get("replicaAddress")),
        runner_replica_id=_nonblank(payload.get("replicaId")),
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

    async def start_attempt(
        self,
        *,
        provider: str,
        project_id: str,
        secret_id: str,
    ) -> RunnerLoginAttempt:
        """Start an attempt. The ids tell the runner where to report the outcome."""
        url = self._url("/subscription-login/attempts")
        try:
            async with httpx.AsyncClient(timeout=_START_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    url,
                    json={
                        "provider": provider,
                        "projectId": project_id,
                        "secretId": secret_id,
                    },
                    headers=self._headers(),
                )
        except httpx.HTTPError as e:
            _log_hop("start", "unreachable", error=str(e))
            raise SubscriptionLoginRunnerUnavailable() from e

        if response.status_code >= 300:
            _log_hop("start", "refused", status=response.status_code)
            raise SubscriptionLoginRunnerUnavailable(
                message=(
                    "The agent runner refused to start the sign-in "
                    f"(status {response.status_code})."
                )
            )

        return _parse_attempt(_json_body(response), fallback_attempt_id="")

    async def delete_attempt(
        self,
        *,
        attempt_id: str,
        base_url: Optional[str] = None,
        runner_replica_id: Optional[str] = None,
    ) -> bool:
        """Stop an attempt on the runner. Never raises: the row is the source of truth.

        `base_url` is the address of the pod that runs the attempt's provider poll, and
        `runner_replica_id` is that pod's replica id. The call goes to the address only when
        the pod there answers as that replica; otherwise, and without an address, it goes to
        the Service URL, which picks any pod. A DELETE that reaches a pod without the attempt
        is a no-op there.
        """
        if not self.configured:
            return False

        target = self._base_url
        timeout = httpx.Timeout(_DELETE_TIMEOUT_SECONDS)
        if base_url and await runner_address_is_replica(
            address=base_url, replica_id=runner_replica_id
        ):
            target = base_url
            timeout = httpx.Timeout(
                _DELETE_TIMEOUT_SECONDS, connect=RUNNER_ADDRESS_CONNECT_TIMEOUT_SECONDS
            )

        url = str(target).rstrip("/") + f"/subscription-login/attempts/{attempt_id}"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.delete(url, headers=self._headers())
        except httpx.HTTPError as e:
            _log_hop("delete", "unreachable", attempt_id=attempt_id, error=str(e))
            return False

        return response.status_code < 300 or response.status_code == 404


def _json_body(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError as e:
        raise SubscriptionLoginRunnerUnavailable(
            message="The agent runner answered the sign-in with an unreadable body."
        ) from e
