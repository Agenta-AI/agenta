"""Transports to the TypeScript runner: HTTP (a running sidecar) or subprocess (a CLI).

Shared by the runner-backed adapters. Each adapter chooses a transport and hard-codes its
own engine id on the payload (via ``utils.wire``); this module only delivers the JSON.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator, Dict, Optional, Sequence

from agenta.sdk.utils.logging import get_module_logger

_DEFAULT_TIMEOUT = float(os.getenv("AGENTA_AGENT_RUNNER_TIMEOUT_SECONDS", "180"))

log = get_module_logger(__name__)


def _runner_auth_headers() -> Dict[str, str]:
    """The ``Authorization`` header for the runner's optional shared-token gate, if configured.

    The runner enables a ``/run`` token check only when ``AGENTA_AGENT_RUNNER_TOKEN`` is set on
    its side (default OFF; see ``server.ts``). When the gate is on, an un-tokened POST is rejected
    with 401, which would lock the co-located Python service out. Set the SAME env var here and we
    present it as ``Authorization: Bearer <token>`` (the runner also accepts this header). Unset =
    no header, matching the runner's default-off behavior, so loopback deployments are unaffected.
    Read per-call (not cached) so a test or runtime env change takes effect without a re-import.
    """
    token = os.getenv("AGENTA_AGENT_RUNNER_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


def _transport_error(user_message: str, *, detail: str) -> RuntimeError:
    """A transport RuntimeError whose surfaced text is clean; the raw detail is logged only.

    The HTTP body / process stderr / raw stdout that pinpoints a transport failure is internal:
    log it for diagnosis but keep it out of the caller/UI-facing error, which gets only the
    short ``user_message``. Mirrors ``wire.sanitize_runner_error`` for the result boundary.
    """
    if detail:
        log.warning("agent: %s | detail: %s", user_message, detail)
    return RuntimeError(user_message)


async def deliver_http(
    base_url: str,
    payload: Dict[str, Any],
    *,
    timeout: float = _DEFAULT_TIMEOUT,
) -> Dict[str, Any]:
    """POST ``/run`` to a running runner and return the parsed JSON body."""
    import httpx  # local import: only the HTTP transport needs it

    url = base_url.rstrip("/") + "/run"
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=_runner_auth_headers())
    # Any non-2xx is a transport failure; 4xx left to fall through surfaces as an opaque
    # JSON parse error instead of a clear runner failure. The response body can carry internal
    # detail, so it is logged, not surfaced.
    if response.status_code >= 400:
        raise _transport_error(
            f"Agent runner HTTP {response.status_code}",
            detail=response.text[:1000],
        )
    return response.json()


async def deliver_subprocess(
    command: Sequence[str],
    payload: Dict[str, Any],
    *,
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
    timeout: float = _DEFAULT_TIMEOUT,
) -> Dict[str, Any]:
    """Spawn the runner CLI, feed the request on stdin, and parse the JSON on stdout."""
    proc = await asyncio.create_subprocess_exec(
        *command,
        cwd=cwd,
        env=env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    body = json.dumps(payload).encode("utf-8")
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=body), timeout=timeout
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError(
            f"Agent runner timed out after {timeout}s: {' '.join(command)}"
        )

    out = stdout.decode("utf-8", "replace")
    err = stderr.decode("utf-8", "replace")
    if not out.strip():
        raise _transport_error(
            "Agent runner returned no output",
            detail=f"exit={proc.returncode} stderr={err[-2000:]}",
        )
    try:
        return json.loads(out)
    except json.JSONDecodeError as exc:
        raise _transport_error(
            "Agent runner returned invalid JSON",
            detail=f"stdout={out[:500]} stderr={err[-1000:]}",
        ) from exc


# ---------------------------------------------------------------------------
# Streaming transports (NDJSON): one parsed record per line, live.
#
# Each yields the runner's ``StreamRecord`` lines as they arrive — ``{"kind":"event",...}``
# for every event the moment it is built, then exactly one ``{"kind":"result",...}`` terminal
# record. The caller (a ``Session.stream``) turns these into live ``AgentEvent``s and the
# terminal ``AgentResult``. Cancellation closes the underlying connection / kills the child.
# ---------------------------------------------------------------------------


async def deliver_http_stream(
    base_url: str,
    payload: Dict[str, Any],
    *,
    timeout: float = _DEFAULT_TIMEOUT,
) -> AsyncIterator[Dict[str, Any]]:
    """POST ``/run`` asking for NDJSON and yield each parsed record as it arrives.

    The ``async with`` closes the connection when the generator is closed or cancelled, which
    the runner observes as a client disconnect and turns into run cancellation.
    """
    import httpx  # local import: only the HTTP transport needs it

    url = base_url.rstrip("/") + "/run"
    headers = {"Accept": "application/x-ndjson", **_runner_auth_headers()}
    saw_result = False
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST", url, json=payload, headers=headers
        ) as response:
            if response.status_code >= 400:
                body = await response.aread()
                raise _transport_error(
                    f"Agent runner HTTP {response.status_code}",
                    detail=repr(body[:1000]),
                )
            async for line in response.aiter_lines():
                line = line.strip()
                if line:
                    record = json.loads(line)
                    if record.get("kind") == "result":
                        saw_result = True
                    yield record
    if not saw_result:
        raise RuntimeError("Agent runner stream ended without a terminal result record")


async def deliver_subprocess_stream(
    command: Sequence[str],
    payload: Dict[str, Any],
    *,
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
    timeout: float = _DEFAULT_TIMEOUT,
) -> AsyncIterator[Dict[str, Any]]:
    """Spawn the runner CLI in ``--stream`` mode and yield each NDJSON record from stdout.

    The ``finally`` kills the child if the consumer stops early (break/cancel), so a dropped
    stream does not leave a runner process behind.
    """
    proc = await asyncio.create_subprocess_exec(
        *command,
        "--stream",
        cwd=cwd,
        env=env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdin is not None and proc.stdout is not None
    proc.stdin.write(json.dumps(payload).encode("utf-8"))
    proc.stdin.close()
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    saw_result = False
    try:
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise RuntimeError(
                    f"Agent runner stream timed out after {timeout}s: {' '.join(command)}"
                )
            raw = await asyncio.wait_for(proc.stdout.readline(), timeout=remaining)
            if not raw:  # EOF
                break
            line = raw.decode("utf-8", "replace").strip()
            if line:
                record = json.loads(line)
                if record.get("kind") == "result":
                    saw_result = True
                yield record
        await proc.wait()
        # A clean drain that never produced a terminal result means the runner exited or
        # disconnected early; fail loud rather than leaving the consumer without a result.
        if not saw_result:
            err = b""
            if proc.stderr is not None:
                err = await proc.stderr.read()
            raise _transport_error(
                "Agent runner stream ended without a terminal result record",
                detail=f"exit={proc.returncode} "
                f"stderr={err.decode('utf-8', 'replace')[-2000:]}",
            )
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
