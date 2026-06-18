"""LocalBackend: run a harness on this machine, no rivet daemon and no Agenta sidecar.

This is the backend a standalone SDK user gets. It is two mechanisms, one per harness, which
is exactly a backend's "plumbing per harness" job:

- Pi   -> the bundled JS runner (the in-process Pi engine), shipped inside the wheel, run
          with ``node``.
- Claude -> the pure-Python ``claude-agent-sdk``, in-process, no TS bridge.

NOT YET IMPLEMENTED. Tracked as Phase 3 (Pi) and Phase 4 (Claude) in
``docs/design/agent-workflows/scratch/sdk-local-backend/plan.md``. The class is present so
the adapter layout is complete and the port shape is visible; the methods raise until the
bundling build step and the ``claude-agent-sdk`` wiring land.
"""

from __future__ import annotations

from typing import Mapping, Optional

from ..dtos import HarnessAgentConfig, HarnessType, TraceContext
from ..interfaces import Backend, Sandbox, Session


class LocalBackend(Backend):
    """Run Pi (bundled JS) or Claude (``claude-agent-sdk``) on this machine."""

    supported_harnesses = frozenset({HarnessType.PI, HarnessType.CLAUDE})

    async def create_sandbox(self) -> Sandbox:
        raise NotImplementedError(
            "LocalBackend is not implemented yet (Phase 3: Pi via bundled JS, "
            "Phase 4: Claude via claude-agent-sdk)."
        )

    async def create_session(
        self,
        sandbox: Sandbox,
        config: HarnessAgentConfig,
        *,
        harness: HarnessType,
        secrets: Optional[Mapping[str, str]] = None,
        trace: Optional[TraceContext] = None,
        session_id: Optional[str] = None,
    ) -> Session:
        raise NotImplementedError(
            "LocalBackend is not implemented yet (Phase 3: Pi via bundled JS, "
            "Phase 4: Claude via claude-agent-sdk)."
        )
