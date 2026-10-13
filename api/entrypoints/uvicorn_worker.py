"""The gunicorn worker class the API runs under.

Uvicorn's stock `UvicornWorker` drains open requests on shutdown, but two gaps cut a long
response (an LLM gateway stream can run for many minutes) when gunicorn recycles a worker
at `--max-requests`:

- The worker heartbeats the arbiter only from uvicorn's main loop, and that loop has
  already ended while the worker drains. After `--timeout` seconds without a heartbeat the
  arbiter kills the worker with SIGABRT, whatever `--graceful-timeout` says.
- Uvicorn's own drain has no deadline (`timeout_graceful_shutdown` is unset), so on a
  max-requests recycle, where the arbiter does not time the exit, a response that never
  ends would hold the old worker forever.

This worker keeps the heartbeat going while the drain runs, and bounds the drain by
`--graceful-timeout`. The heartbeat is a task on the worker's event loop, so a blocked loop
still stops it and the arbiter's hung-worker check keeps working. The heartbeat also stops
a few seconds after the drain deadline: the application's lifespan shutdown runs after the
drain and has no deadline of its own, so a cleanup that hangs there is left to the
arbiter's `--timeout` check instead of keeping a worker alive that serves nothing.

On SIGTERM (a container stop or a pod termination) the arbiter itself waits
`--graceful-timeout` and then sends SIGKILL, so the same bound applies on both paths.
"""

import asyncio
import socket
import sys
from typing import Any, Callable, Optional

from gunicorn.arbiter import Arbiter
from uvicorn.config import Config
from uvicorn.server import Server
from uvicorn.workers import UvicornWorker

# How often a draining worker tells the arbiter it is alive. The arbiter compares the last
# heartbeat with `--timeout`, so any interval well below the smallest sane timeout works.
DRAIN_HEARTBEAT_SECONDS = 1.0

# How long after the drain deadline the heartbeat goes on, to cover the cancellation of the
# requests still open at the deadline.
HEARTBEAT_AFTER_DRAIN_SECONDS = 5.0


class _DrainingServer(Server):
    def __init__(self, config: Config, heartbeat: Callable[[], None]) -> None:
        super().__init__(config=config)
        self._heartbeat = heartbeat

    async def shutdown(self, sockets: Optional[list[socket.socket]] = None) -> None:
        beating = asyncio.ensure_future(self._beat())
        try:
            await super().shutdown(sockets=sockets)
        finally:
            beating.cancel()

    async def _beat(self) -> None:
        drain_timeout = self.config.timeout_graceful_shutdown
        loop = asyncio.get_running_loop()
        deadline = (
            None
            if drain_timeout is None
            else loop.time() + drain_timeout + HEARTBEAT_AFTER_DRAIN_SECONDS
        )
        while deadline is None or loop.time() < deadline:
            self._heartbeat()
            await asyncio.sleep(DRAIN_HEARTBEAT_SECONDS)


class DrainingUvicornWorker(UvicornWorker):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.config.timeout_graceful_shutdown = self.cfg.graceful_timeout

    async def _serve(self) -> None:
        # The parent's `_serve`, with the server that keeps the heartbeat during the drain.
        self.config.app = self.wsgi
        server = _DrainingServer(config=self.config, heartbeat=self.notify)
        self._install_sigquit_handler()
        await server.serve(sockets=self.sockets)
        if not server.started:
            sys.exit(Arbiter.WORKER_BOOT_ERROR)
