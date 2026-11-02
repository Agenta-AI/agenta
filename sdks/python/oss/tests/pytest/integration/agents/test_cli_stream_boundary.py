"""The real ``cli.ts --stream`` boundary: does the runner's own CLI emit what the
SDK's stream transport expects?

Lives here rather than under ``unit/`` because it spawns ``pnpm exec tsx``
against ``services/runner`` and executes that component's TypeScript. The
SDK-side half of the same boundary — ``AgentStream`` over a fake record source,
and ``deliver_subprocess_stream`` against a fake NDJSON emitter — is pure and
stays in ``unit/agents/test_streaming.py``.

Unlike its neighbours here it does spawn a real child process, so it needs the
runner's dependencies installed (``pnpm install`` in ``services/runner``).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenta.sdk.agents import AgentStream
from agenta.sdk.agents.utils import deliver_subprocess_stream


_RUNNER_DIR = Path(__file__).resolve().parents[7] / "services" / "runner"

# tsx is the real dependency, not pnpm: pnpm resolves in any worktree while tsx
# only exists once `pnpm install` has run, and without it the CLI prints
# "undefined" that the caller then parses as JSON.
_TSX = _RUNNER_DIR / "node_modules" / ".bin" / "tsx"

pytestmark = pytest.mark.skipif(
    not _TSX.exists(),
    reason=f"tsx not installed under {_RUNNER_DIR} — run `pnpm install` there",
)

_CMD = ["pnpm", "exec", "tsx", "src/cli.ts"]


async def test_cli_stream_terminal_only_on_empty_request() -> None:
    records = []
    async for record in deliver_subprocess_stream(_CMD, {}, cwd=str(_RUNNER_DIR)):
        records.append(record)

    # An empty request fails before any event, so the stream is exactly one result record.
    assert len(records) == 1, records
    assert records[0]["kind"] == "result"
    assert records[0]["result"]["ok"] is False

    # AgentStream surfaces that failure as a RuntimeError, just like the one-shot path.
    run = AgentStream(deliver_subprocess_stream(_CMD, {}, cwd=str(_RUNNER_DIR)))
    with pytest.raises(RuntimeError):
        async for _ in run:
            pass
