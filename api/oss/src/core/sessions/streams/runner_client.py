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

from typing import NamedTuple, Optional

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

# A dead pod's IP can drop packets rather than refuse them, and a pod in the cluster connects in
# milliseconds, so the health check and the connect to a pod address give up after this.
RUNNER_ADDRESS_CONNECT_TIMEOUT_SECONDS = 2.0


async def runner_address_is_replica(
    client: httpx.AsyncClient,
    *,
    address: str,
    replica_id: Optional[str],
) -> bool:
    """True when the pod at `address` answers `GET /health` with `replica_id`.

    Kubernetes can give a dead runner pod's IP to another pod, so a stored pod address is
    checked before the runner token goes there. The check sends no token: `/health` is the
    runner's one unauthenticated route. Any failure, a missing id, or another id is False, and
    the caller then does not use the address. Never raises.

    `client` is the caller's, so the call the caller then sends to the same pod reuses the
    check's connection.
    """
    if not replica_id:
        return False
    url = address.rstrip("/") + "/health"
    try:
        response = await client.get(url, timeout=RUNNER_ADDRESS_CONNECT_TIMEOUT_SECONDS)
        payload = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, httpx.InvalidURL, ValueError) as e:
        log.warning("runner address %s did not answer its health check: %s", url, e)
        return False
    answered = payload.get("replicaId") if isinstance(payload, dict) else None
    if answered != replica_id:
        log.warning(
            "runner address %s answers as replica %r, not the bound %r",
            address,
            answered,
            replica_id,
        )
        return False
    return True


class RunnerCancelResult:
    """What the direct hop learned, as four named cases.

    * `accepted` — the runner holds the session and took the command. The outcome arrives
      later on the outcome route, never in this response.
    * `not_held` — the runner answered, and it does not hold that session.
    * `replica_gone` — the turn's bound pod address did not answer `/health` as the bound
      replica, so nothing was posted. After a restart the old pod is gone and this is the
      answer; a slow live pod gives the same answer, so the caller decides what it means.
    * `unreachable` — no answer, a non-2xx that is not 404, or no runner configured at all.
    """

    accepted = "accepted"
    not_held = "not_held"
    replica_gone = "replica_gone"
    unreachable = "unreachable"


class RunnerCancelResponse(NamedTuple):
    """The acknowledgement, and WHICH runner process gave it.

    `replica_id` is what the API records as the claim holder, so the outcome route's guard
    (`state='claimed' AND claimed_by=:replica_id`) matches the id the runner reports with. Take
    it from the answer rather than assuming one: a claim written under a name the runner does
    not use refuses the runner's own outcome report, which leaves the command open and the
    session marked stopping forever.
    """

    status: str
    replica_id: Optional[str] = None


async def cancel_runner_execution(
    *,
    command_id: str,
    project_id: str,
    session_id: str,
    target_turn_id: Optional[str],
    created_at: str,
    timeout_seconds: float = _CANCEL_TIMEOUT_SECONDS,
    base_url: Optional[str] = None,
    runner_replica_id: Optional[str] = None,
) -> RunnerCancelResponse:
    """POST the runner's `/cancel`. Returns the acknowledgement and the answering replica.

    Never raises. The command row is already committed when this runs, so a failure here costs
    promptness, not the Stop: a later claim or the settlement sweep still reaches it.

    `base_url` is the address of the pod that holds the target turn, and `runner_replica_id` is
    the replica the turn is bound to. The call goes to the address only when the pod there
    answers as that replica; otherwise it is `replica_gone`, never a post to whatever pod now
    has that IP. Without an address the call goes to the Service URL, which picks any pod.

    The body is camelCase because the runner's own HTTP surface is (see its `/kill`).
    """
    target = base_url or env.runner.internal_url
    token = env.runner.token
    if not target or not token:
        log.warning(
            "cancel: no runner internal_url/token configured; command %s cannot be delivered",
            command_id,
        )
        return RunnerCancelResponse(RunnerCancelResult.unreachable)

    timeout = httpx.Timeout(timeout_seconds)
    if base_url:
        timeout = httpx.Timeout(
            timeout_seconds, connect=RUNNER_ADDRESS_CONNECT_TIMEOUT_SECONDS
        )

    url = target.rstrip("/") + "/cancel"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if base_url and not await runner_address_is_replica(
                client, address=base_url, replica_id=runner_replica_id
            ):
                return RunnerCancelResponse(RunnerCancelResult.replica_gone)
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
        return RunnerCancelResponse(RunnerCancelResult.unreachable)

    if response.status_code == 404:
        return RunnerCancelResponse(RunnerCancelResult.not_held)
    if response.status_code >= 300:
        log.warning(
            "cancel: runner /cancel returned %s for session=%s command=%s",
            response.status_code,
            session_id,
            command_id,
        )
        return RunnerCancelResponse(RunnerCancelResult.unreachable)

    replica_id = None
    try:
        payload = response.json()
        if isinstance(payload, dict):
            replica_id = payload.get("replicaId")
    except ValueError:
        # A 2xx with no JSON body still means accepted; the claim then falls back to a
        # placeholder and the runner's report is refused, so log it rather than hide it.
        log.warning(
            "cancel: runner /cancel answered %s with no JSON body for command=%s",
            response.status_code,
            command_id,
        )
    return RunnerCancelResponse(RunnerCancelResult.accepted, replica_id)
