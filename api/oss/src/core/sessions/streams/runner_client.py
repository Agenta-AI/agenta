"""Direct API -> runner HTTP hop, used only by `kill` (W7.3).

Everything else in `core/sessions/` reaches the runner only indirectly, through the Redis
coordination plane (the runner heartbeats/reads locks the API wrote) or through the separate
invoke path (`WorkflowsService` -> the Python agent service -> the runner). `kill` is the one
verb that must reach the runner's OWN sandbox-teardown route (`POST /kill` on
`services/runner/src/server.ts`) directly, because dropping the Redis locks alone does not
tear down a warm sandbox — it only removes the coordination-plane bookkeeping. Without this
call, `kill` was Redis/row-only (see `service.py`'s `kill()` before this module existed) and
the runner's session-pool / in-flight sandbox kept running until its own idle TTL expired.

Same base URL + shared-secret token the Python agent service already uses to reach the runner
(`services/oss/src/agent/config.py`'s `runner_url()`, `AGENTA_RUNNER_TOKEN` on both sides).
Best-effort: `env.runner.internal_url` unset means no direct hop is configured (e.g. a
dev/test composition running the runner as a bare subprocess with no HTTP surface), and any
call failure is swallowed — `kill`'s Redis/row edit must still succeed and be idempotent, and
the runner's own orphan sweep / idle-TTL eviction is the fallback net for a missed signal.
"""

from typing import Optional

import httpx

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_KILL_TIMEOUT_SECONDS = 10.0


async def kill_runner_sandbox(*, project_id: str, session_id: str) -> bool:
    """POST the runner's `/kill`, scoped to (project_id, session_id). Returns True iff the
    call was made and returned 2xx; False otherwise (not configured, network error, non-2xx).
    Never raises — kill's Redis/row edit is the source of truth and must not be blocked by
    the runner being unreachable.
    """
    base_url = env.runner.internal_url
    token = env.runner.token
    if not base_url or not token:
        log.debug(
            "kill: no runner internal_url/token configured, skipping direct sandbox teardown"
        )
        return False

    url = base_url.rstrip("/") + "/kill"
    try:
        async with httpx.AsyncClient(timeout=_KILL_TIMEOUT_SECONDS) as client:
            response = await client.post(
                url,
                json={"sessionId": session_id, "projectId": project_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        if response.status_code >= 300:
            log.warning(
                "kill: runner /kill returned %s for session=%s",
                response.status_code,
                session_id,
            )
            return False
        return True
    except httpx.HTTPError as e:
        log.warning("kill: runner /kill call failed for session=%s: %s", session_id, e)
        return False


_CANCEL_TIMEOUT_SECONDS = 5.0


class RunnerCancelResult:
    """What the direct hop learned, as three named cases.

    * `accepted` — the runner holds the session and took the command. The outcome arrives
      later on the outcome route, never in this response.
    * `not_held` — the runner answered, and it does not hold that session.
    * `unreachable` — no answer, a non-2xx that is not 404, or no runner configured at all.
    """

    accepted = "accepted"
    not_held = "not_held"
    unreachable = "unreachable"


async def cancel_runner_execution(
    *,
    command_id: str,
    project_id: str,
    session_id: str,
    target_turn_id: Optional[str],
    created_at: str,
    timeout_seconds: float = _CANCEL_TIMEOUT_SECONDS,
) -> str:
    """POST the runner's `/cancel`. Returns one of the `RunnerCancelResult` values.

    Never raises. The command row is already committed when this runs, so a failure here costs
    promptness, not the Stop: a later claim or the settlement sweep still reaches it.

    The body is camelCase because the runner's own HTTP surface is (see its `/kill`).
    """
    base_url = env.runner.internal_url
    token = env.runner.token
    if not base_url or not token:
        log.warning(
            "cancel: no runner internal_url/token configured; command %s cannot be delivered",
            command_id,
        )
        return RunnerCancelResult.unreachable

    url = base_url.rstrip("/") + "/cancel"
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                url,
                json={
                    "commandId": command_id,
                    "projectId": project_id,
                    "sessionId": session_id,
                    "targetTurnId": target_turn_id,
                    "createdAt": created_at,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as e:
        log.warning(
            "cancel: runner /cancel call failed for session=%s command=%s: %s",
            session_id,
            command_id,
            e,
        )
        return RunnerCancelResult.unreachable

    if response.status_code == 404:
        return RunnerCancelResult.not_held
    if response.status_code >= 300:
        log.warning(
            "cancel: runner /cancel returned %s for session=%s command=%s",
            response.status_code,
            session_id,
            command_id,
        )
        return RunnerCancelResult.unreachable
    return RunnerCancelResult.accepted
