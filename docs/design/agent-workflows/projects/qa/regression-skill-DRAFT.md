---
name: agent-replay-test
description: Turn one real agent run into a regression test that replays forever without a live LLM. Use when a QA cell is green and worth pinning, when fixing an agent-runtime bug found via a real /run, or any time you want to lock SDK + service behavior against a recorded runner response. Covers capturing a /run pair, redacting volatile fields, and writing the replay test.
---

# Agent replay test: capture once, replay forever

DRAFT skill for review. Graduate into `.agents/skills/` after a first real use. Full rationale
and citations: `docs/design/agent-workflows/qa/regression-testing-research.md`.

## What this gives you

A test that runs the real SDK and service code against a recorded runner response, so the
whole agent path is exercised and the LLM is never called. It is `cost_free` and runs in the
default CI lane. The model ran once, when you captured; CI replays that capture.

## When to use

- A QA matrix cell (`qa/README.md`) is green and you want it to stay green.
- You fixed an agent-runtime bug and want a test that reproduces the original real run.
- You need to pin tool-call behavior or a result-parsing path without paying per run.

Do not use it to assert assistant prose. Assert the structural facts a recorded run proves:
which tool was called with which args, the stop reason, the capability flags, the parsed
result shape. Prose drifts with model versions; structure does not.

## Pick the tier first

One capture can feed three tiers. Decide what the regression actually is:

- Decision before the wire (Claude drops built-ins, Agenta forces a skill)? That is a **unit**
  test against the fakes in `sdks/python/oss/tests/pytest/unit/agents/conftest.py`. No
  fixture. Stop here.
- The `/run` request/result *shape* (a key renamed, a field added)? That is a **golden**
  test. Add or update a file under
  `sdks/python/oss/tests/pytest/unit/agents/golden/` and assert it in `test_wire_contract.py`.
  Then update `protocol.ts` and `KNOWN_REQUEST_KEYS` to match.
- The SDK mishandling a *real runner result* (a dropped event, a lost capability, a tool-call
  the result no longer carries)? That is a **replay** test. Continue below.

## Procedure: capture and write a replay test

### 1. Capture the real /run pair

Run the cell for real through a service path (E1/E2/E3 in `qa/README.md`), or via a `uv run`
SDK script for E4. You need the exact `/run` request the SDK sent and the exact result the
runner returned. Two ways to get them:

- Service path: capture the request body you POST and the JSON response. The `/invoke`
  response also carries `span_id` / `trace_id` for provenance.
- SDK path: temporarily log the dict passed to `request_to_wire` and the dict returned by
  `_deliver` (in `adapters/in_process.py` or `adapters/sandbox_agent.py`). Copy both verbatim.

Save the raw pair to `docs/design/agent-workflows/qa/runs/<cell>.json` as
`{"request": {...}, "result": {...}}`. `<cell>` is environment-harness-capability, e.g.
`e1-pi-gateway-tool`. This is provenance, not the test fixture yet.

### 2. Redact volatile fields

Scrub at capture time, so the committed file is already clean. Replace, do not delete:

- Secrets: every value in `request.secrets`, plus `request.trace.authorization` and
  `request.toolCallback.authorization` -> use the existing placeholder convention
  (`sk-test`, `sk-ant`, `"Access tok-123"`). Never commit a real key.
- Volatile ids: `request.trace.traceparent`, `result.traceId`, `result.sessionId`, and any
  `tool_call.id` -> fixed placeholders (`trace-abc`, `sess-42`), or drop them from the
  assertion.
- Ports and hosts: `toolCallback.endpoint`, `trace.endpoint` -> a fixed host like
  `https://api.example/...`.
- Numbers: leave `usage` / `cost` / durations in the file, but never assert exact values
  (assert keys exist or `total == input + output`).

### 3. Place the test fixture

Copy the redacted `result` (and, if you assert the request, the `request`) into
`sdks/python/oss/tests/pytest/integration/agents/recordings/<cell>.json`. `runs/` keeps the
provenance copy; `recordings/` is what the test loads.

### 4. Write the replay test

Mirror `integration/agents/test_transport_roundtrip.py`. Swap the echo runner for one that
prints the recorded result. The subprocess form exercises the real transport, so prefer it.

```python
import json, sys
from pathlib import Path
import pytest
from agenta.sdk.agents import (
    AgentConfig, Environment, InProcessPiBackend, Message, PiHarness, SessionConfig,
)

pytestmark = [pytest.mark.integration, pytest.mark.cost_free]  # never llm_required

REC = Path(__file__).parent / "recordings"

def _replay_backend(tmp_path, result: dict) -> InProcessPiBackend:
    # A runner that ignores the request and prints the recorded result verbatim.
    script = tmp_path / "replay_runner.py"
    script.write_text(
        "import sys, json\n"
        "sys.stdin.read()\n"
        f"sys.stdout.write(json.dumps({result!r}))\n",
        encoding="utf-8",
    )
    return InProcessPiBackend(command=[sys.executable, str(script)], cwd=str(tmp_path))

async def test_pi_gateway_tool_replays(tmp_path):
    rec = json.loads((REC / "e1-pi-gateway-tool.json").read_text())
    harness = PiHarness(Environment(_replay_backend(tmp_path, rec["result"])))
    config = SessionConfig(agent=AgentConfig(instructions="hi", model="gpt-5.5"))

    result = await harness.prompt(config, [Message(role="user", content="...")])

    # Assert STRUCTURE the real run proved, not prose.
    assert [e.type for e in result.events] == ["tool_call", "tool_result", "message", "done"]
    tool_call = next(e for e in result.events if e.type == "tool_call")
    assert tool_call.data["name"] == "get_user"
    assert result.stop_reason == "end_turn"
    assert result.capabilities.mcp_tools is True
```

HTTP-transport variant: if the path under test is the `url=` backend (`deliver_http`), mock
`POST /run` with `respx` instead of a subprocess runner, returning `rec["result"]` as the
JSON body. `respx` is httpx-native and async, matching our `httpx.AsyncClient`.

### 5. Assert the request too, when the request is the point

If the capture exists to prove the SDK *builds* the right request (not just parses the
result), assert `request_to_wire(...) == rec["request"]` and that
`set(payload) <= KNOWN_REQUEST_KEYS`. This is the golden check (Tier 2) riding the same
fixture.

### 6. Run it

```bash
cd sdks/python && uv run python -m pytest \
  oss/tests/pytest/integration/agents/ -m "integration and cost_free" -n0
```

`-n0` avoids xdist flakiness on subprocess tests. Then `ruff format` and `ruff check --fix`
before committing.

## Guardrails

- Replay tests are `integration` + `cost_free`, never `llm_required`. If a test needs a live
  model, it is a capture/acceptance run, not a replay test. Keep them separate.
- A changed `golden/*.json` is a contract change. Update `protocol.ts` and
  `KNOWN_REQUEST_KEYS` in the same PR, and eyeball the diff before committing (treat it like a
  snapshot review).
- Redact at capture time, not at assert time. The committed fixture must already be clean.
- One real key never reaches the repo. Re-grep the fixture for `sk-`, `Bearer`, and real host
  names before committing.
