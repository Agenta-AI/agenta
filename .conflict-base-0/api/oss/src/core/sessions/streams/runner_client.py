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
