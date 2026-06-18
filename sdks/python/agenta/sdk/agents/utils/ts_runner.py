"""Transports to the TypeScript runner: HTTP (a running sidecar) or subprocess (a CLI).

Shared by the runner-backed adapters. Each adapter chooses a transport and hard-codes its
own engine id on the payload (via ``utils.wire``); this module only delivers the JSON.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator, Dict, Optional, Sequence

_DEFAULT_TIMEOUT = float(os.getenv("AGENTA_AGENT_TIMEOUT", "180"))


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
        response = await client.post(url, json=payload)
    if response.status_code >= 500:
        raise RuntimeError(
            f"Agent runner HTTP {response.status_code}: {response.text[:1000]}"
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
        raise RuntimeError(
            f"Agent runner returned no output. exit={proc.returncode} stderr={err[-2000:]}"
        )
    try:
        return json.loads(out)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Agent runner returned invalid JSON. stdout={out[:500]} stderr={err[-1000:]}"
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
    headers = {"Accept": "application/x-ndjson"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST", url, json=payload, headers=headers
        ) as response:
            if response.status_code >= 500:
                body = await response.aread()
                raise RuntimeError(
                    f"Agent runner HTTP {response.status_code}: {body[:1000]!r}"
                )
            async for line in response.aiter_lines():
                line = line.strip()
                if line:
                    yield json.loads(line)


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
                yield json.loads(line)
        await proc.wait()
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
