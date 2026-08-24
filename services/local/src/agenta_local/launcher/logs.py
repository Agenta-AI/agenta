"""Private timestamped launcher logs with bounded retention."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Self


@dataclass
class ComponentLog:
    path: Path
    stream: BinaryIO

    def close(self) -> None:
        self.stream.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


class LogManager:
    def __init__(
        self,
        directory: Path,
        *,
        retain: int = 5,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.directory = directory
        self.retain = retain
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)

    def open(self, component: str) -> ComponentLog:
        self.rotate(component)
        stamp = self.clock().strftime("%Y%m%dT%H%M%S.%fZ")
        path = self.directory / f"{component}-{stamp}-{os.getpid()}.log"
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(path, flags, 0o600)
        os.fchmod(fd, 0o600)
        return ComponentLog(path=path, stream=os.fdopen(fd, "wb", buffering=0))

    def rotate(self, component: str) -> None:
        paths = sorted(
            self.directory.glob(f"{component}-*.log"),
            key=lambda path: path.stat().st_mtime_ns,
            reverse=True,
        )
        keep_before_open = max(self.retain - 1, 0)
        for path in paths[keep_before_open:]:
            path.unlink(missing_ok=True)


def contains_since(path: Path, offset: int, needle: bytes) -> bool:
    try:
        with path.open("rb") as stream:
            stream.seek(offset)
            return needle.lower() in stream.read().lower()
    except OSError:
        return False
