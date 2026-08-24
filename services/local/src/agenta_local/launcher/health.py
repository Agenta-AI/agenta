"""Deadline-bounded loopback readiness and graceful-shutdown requests."""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from collections.abc import Callable

from .processes import ManagedProcess

RequestFunction = Callable[[urllib.request.Request, float], int]


def _request(request: urllib.request.Request, timeout: float) -> int:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return int(response.status)


def wait_for_endpoint(
    url: str,
    *,
    deadline: float,
    token: str | None = None,
    process: ManagedProcess | None = None,
    request: RequestFunction = _request,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    cancelled: Callable[[], bool] = lambda: False,
) -> bool:
    end = monotonic() + deadline
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    target = urllib.request.Request(url, headers=headers, method="GET")
    while monotonic() < end:
        if cancelled():
            return False
        if process is not None and process.poll() is not None:
            return False
        remaining = max(end - monotonic(), 0.01)
        try:
            if request(target, min(2.0, remaining)) == 200:
                return True
        except (OSError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
            pass
        sleep(min(0.1, max(end - monotonic(), 0)))
    return False


def wait_for_runner(
    url: str,
    token: str,
    *,
    deadline: float,
    process: ManagedProcess | None = None,
    request: RequestFunction = _request,
    cancelled: Callable[[], bool] = lambda: False,
) -> bool:
    started = time.monotonic()
    if not wait_for_endpoint(
        f"{url}/health",
        deadline=deadline,
        process=process,
        request=request,
        cancelled=cancelled,
    ):
        return False
    remaining = deadline - (time.monotonic() - started)
    return remaining > 0 and wait_for_endpoint(
        f"{url}/subscription-status",
        deadline=remaining,
        token=token,
        process=process,
        request=request,
        cancelled=cancelled,
    )


def request_service_shutdown(
    url: str,
    browser_session: str,
    *,
    timeout: float = 2.0,
    request: RequestFunction = _request,
) -> bool:
    target = urllib.request.Request(
        f"{url}/api/runtime/shutdown",
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "Origin": url,
            "Cookie": f"agenta_local_session={browser_session}",
        },
        method="POST",
    )
    try:
        return request(target, timeout) == 202
    except (OSError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return False
