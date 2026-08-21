# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Run the REAL live egress over the golden record fixtures and save the tool-related chunks.

The live path is `agent_stream_to_vercel_stream`
(sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:378), which consumes the same neutral
`{"type", "data"}` agenta events the records log persists. Feeding it the fixture records
reproduces exactly the Vercel UI Message Stream the browser assembles on a live turn, so the
replayed parts can be compared against it directly instead of against a guess.

Records are split into turns on `done`, the way the runner emits one stream per turn, and only
agent-sourced records are fed (a user message never rides the agent's egress).

Must run from `sdks/python` so the SDK resolves, and NOT from a directory holding a module that
shadows a stdlib name (the script's own directory goes on `sys.path`):

    cd sdks/python
    FIX=../../web/oss/src/components/AgentChatSlice/assets/__fixtures__
    for n in arabicPoetrySession testRunApprovalsSession connectAndFormsSession abandonedFormSession; do
        uv run --no-sync python $FIX/generate/build_live_chunks.py $FIX/$n.json $FIX/$n.liveChunks.json
    done
"""

import asyncio
import json
import sys
from pathlib import Path

from agenta.sdk.agents.adapters.vercel.stream import agent_stream_to_vercel_stream

KEEP = {
    "tool-input-start",
    "tool-input-available",
    "tool-output-available",
    "tool-output-error",
    "tool-approval-request",
    "tool-approval-response",
    "data-render",
    "data-approval-manifest",
}


async def run_turn(events):
    async def gen():
        for event in events:
            yield event

    return [
        part
        async for part in agent_stream_to_vercel_stream(gen())
        if part.get("type") in KEEP
    ]


async def main():
    records = json.loads(Path(sys.argv[1]).read_text())
    turns, current = [], []
    for record in records:
        if record.get("sender") != "agent":
            continue
        payload = record.get("payload") or {}
        current.append(
            {
                "type": payload.get("type") or record.get("session_update"),
                "data": payload,
            }
        )
        if (payload.get("type") or record.get("session_update")) == "done":
            turns.append(current)
            current = []
    if current:
        turns.append(current)

    out = []
    for turn in turns:
        out.extend(await run_turn(turn))
    Path(sys.argv[2]).write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"{sys.argv[2]}: {len(turns)} turns, {len(out)} tool chunks")


asyncio.run(main())
