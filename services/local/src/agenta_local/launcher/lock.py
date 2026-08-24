"""One non-blocking flock held across migration, service, and shutdown."""

from __future__ import annotations

import fcntl
import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Self


class WorkspaceLocked(RuntimeError):
    def __init__(self, workspace: str) -> None:
        self.workspace = workspace
        super().__init__(f"Agenta Local workspace is already running: {workspace}")


@dataclass
class WorkspaceLock:
    path: Path
    fd: int
    workspace: str
    _closed: bool = False

    @classmethod
    def acquire(cls, path: Path, workspace: Path) -> WorkspaceLock:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        flags = os.O_RDWR | os.O_CREAT | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(path, flags, 0o600)
        try:
            os.fchmod(fd, 0o600)
            metadata = os.fstat(fd)
            if not stat.S_ISREG(metadata.st_mode):
                raise OSError(f"workspace lock is not a regular file: {path}")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                active = _read_workspace(fd, fallback=str(workspace))
                raise WorkspaceLocked(active) from exc
            label = str(workspace.resolve())
            payload = json.dumps({"workspace": label, "pid": os.getpid()}) + "\n"
            os.ftruncate(fd, 0)
            os.lseek(fd, 0, os.SEEK_SET)
            os.write(fd, payload.encode("utf-8"))
            os.fsync(fd)
            return cls(path=path, fd=fd, workspace=label)
        except Exception:
            os.close(fd)
            raise

    @classmethod
    def inherited(cls, path: Path, fd: int, workspace: Path) -> WorkspaceLock:
        """Take ownership of a descriptor inherited from the launcher.

        Do not call LOCK_UN on this shared open-file description. Closing the
        service copy leaves the launcher's copy, and therefore its lock, alive.
        """
        metadata = os.fstat(fd)
        path_metadata = path.stat()
        if not stat.S_ISREG(metadata.st_mode) or (
            metadata.st_dev,
            metadata.st_ino,
        ) != (path_metadata.st_dev, path_metadata.st_ino):
            raise RuntimeError(
                "inherited workspace lock descriptor does not match lock file"
            )
        return cls(path=path, fd=fd, workspace=str(workspace.resolve()))

    def close(self) -> None:
        if not self._closed:
            os.close(self.fd)
            self._closed = True

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


def _read_workspace(fd: int, fallback: str) -> str:
    try:
        os.lseek(fd, 0, os.SEEK_SET)
        payload = os.read(fd, 4096).decode("utf-8")
        value = json.loads(payload).get("workspace")
        return str(value) if value else fallback
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        return fallback
