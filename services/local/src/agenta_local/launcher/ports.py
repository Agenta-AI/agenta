"""Loopback port selection and bind-race retry policy."""

from __future__ import annotations

import socket
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

from .logs import contains_since

LOOPBACK = "127.0.0.1"
T = TypeVar("T")


def pick_loopback_port(
    socket_factory: Callable[..., socket.socket] = socket.socket,
) -> int:
    with socket_factory(socket.AF_INET, socket.SOCK_STREAM) as candidate:
        candidate.bind((LOOPBACK, 0))
        return int(candidate.getsockname()[1])


def retry_eaddrinuse(
    attempt: Callable[[int], tuple[T, bool]],
    *,
    log_path: Path,
    choose_port: Callable[[], int] = pick_loopback_port,
    attempts: int = 5,
) -> tuple[T, int]:
    """Retry only when a failed child explicitly reports EADDRINUSE."""
    attempted = 0
    for index in range(attempts):
        attempted = index + 1
        offset = log_path.stat().st_size if log_path.exists() else 0
        port = choose_port()
        result, ready = attempt(port)
        if ready:
            return result, port
        collision = contains_since(log_path, offset, b"EADDRINUSE") or contains_since(
            log_path, offset, b"address already in use"
        )
        if index + 1 == attempts or not collision:
            break
    raise RuntimeError(
        f"process failed to bind a loopback port after {attempted} attempt(s); "
        f"log: {log_path}"
    )
