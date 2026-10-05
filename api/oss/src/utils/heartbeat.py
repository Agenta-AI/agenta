"""A progress signal a liveness probe can read.

## Why this exists

The worker and cron containers each run their process as PID 1, so a process that
exits takes the container with it and the kubelet restarts it already. Nothing
noticed the failure that actually matters for a worker: a process that is alive and
no longer making progress. The probes that used to be there ran `pgrep` against that
same PID 1, which told the kubelet nothing it did not know, and `pgrep` is not even
in the image (agenta#7334).

So the loop writes the current time to a file on every turn, and the probe fails when
that file goes stale. A worker wedged inside a batch, blocked on a socket with no
timeout, or stuck in a retry loop stops writing, and the probe sees it.

## What it deliberately is not

It is not a readiness signal, and it is not a metric. It says "this loop turned
recently" and nothing else. It cannot tell you the loop is doing useful work, only
that it is still going round.

## Behaviour

`AGENTA_HEARTBEAT_FILE` is empty by default, and then every call here does nothing.
That keeps the file out of deployments that do not probe for it, including every
existing self-hosted install. A deployment that wants the probe sets the variable and
points the probe at the same path, so the writer and the reader cannot disagree about
where the file is. The Helm chart sets both from one value.

Writing never raises into the caller. A full disk or a read-only filesystem must not
be able to kill a worker loop, and a heartbeat that cannot be written shows up as a
stale file, which is exactly the signal the probe already handles.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import time
from typing import Optional

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_WARNED = False


def path() -> Optional[str]:
    """The configured heartbeat file, or None when the feature is off."""
    configured = (env.agenta.workers.heartbeat_file or "").strip()
    return configured or None


def touch(*, now: Optional[float] = None) -> bool:
    """Record that the caller's loop just turned. Returns whether anything was written.

    The write goes to a temporary file in the same directory and is then renamed over
    the target, so a probe reading at the wrong moment sees either the old timestamp
    or the new one, never a half-written file. A reader that saw an empty file would
    compute a nonsense age and restart a healthy pod.
    """
    global _WARNED

    target = path()
    if not target:
        return False

    stamp = int(now if now is not None else time.time())

    try:
        directory = os.path.dirname(target) or "."
        os.makedirs(directory, exist_ok=True)
        handle, temporary = tempfile.mkstemp(dir=directory, prefix=".heartbeat-")
        try:
            with os.fdopen(handle, "w") as writer:
                writer.write(f"{stamp}\n")
            os.replace(temporary, target)
        except BaseException:
            # Leave nothing behind if the rename never happened.
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
        return True
    except Exception:  # noqa: BLE001 - a heartbeat must never break its caller
        if not _WARNED:
            _WARNED = True
            log.warn(
                "[heartbeat] could not write the heartbeat file; the liveness probe "
                "will see it go stale and restart this pod",
                path=target,
                exc_info=True,
            )
        return False


def age_seconds(*, now: Optional[float] = None) -> Optional[float]:
    """How old the recorded timestamp is, or None when there is nothing to read.

    Only used by tests and by anyone debugging a probe. The probe itself reads the
    file with a shell, so it needs nothing from this module.
    """
    target = path()
    if not target:
        return None
    try:
        with open(target) as reader:
            stamp = int(reader.read().strip())
    except (OSError, ValueError):
        return None
    return (now if now is not None else time.time()) - stamp


async def ticker(*, interval_seconds: float = 15.0) -> None:
    """Write the heartbeat on an interval, for a loop we do not own.

    The queue worker hands its loop to taskiq's Receiver, so there is no per-turn
    place to report from. This task runs beside it on the same event loop.

    BE CLEAR ABOUT WHAT THIS PROVES. It proves the event loop is still turning, which
    is what catches the common hang: synchronous work, or an await that never returns,
    blocks the loop and this task stops writing. It does NOT prove tasks are being
    consumed. A receiver that polls forever and processes nothing keeps this fresh.

    It is deliberately not conditional on work arriving. An idle queue is normal, and
    a probe that restarted an idle worker would be worse than no probe.
    """
    if not path():
        return

    while True:
        touch()
        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            return
