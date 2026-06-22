# Regression testing research: durable replay tests for the agent runtime

This is the research behind the agent-workflows regression-test program. The goal is to turn
real agent runs into tests that run forever in CI without calling a paid LLM. The findings
are organized by the three tiers the QA README names: pure unit, wire-contract golden, and
replay. Each section maps a practice to an exact file in this repo and says how it composes
with the fakes and golden fixtures that already exist.

Read this with `qa/README.md` (the loop) and the draft skill in `regression-skill-DRAFT.md`
(the procedure). This file is the why; the skill is the how.

## The core idea, in one paragraph

An agent run is non-deterministic at exactly one boundary: the LLM. Everything else in our
stack is ordinary deterministic code. The SDK builds a `/run` request, a transport ships it,
the runner drives the harness and the model, and the SDK parses the `/run` result. If we
record one real request and its result at that boundary and replay the result through a fake
transport, the SDK and the service run for real and only the model is faked. This is the
record-and-replay pattern that the AI-agent testing literature now treats as the standard
regression layer. Block's engineering team calls it the "reproducible reality" tier: "Record
a good session, commit the fixture, and now we have a regression test that captures real
model behavior."
([Block Engineering](https://engineering.block.xyz/blog/testing-pyramid-for-ai-agents))

## Where the LLM nondeterminism actually lives in our stack

One boundary, named precisely so the redaction and replay points are unambiguous:

- The SDK serializes a turn in `request_to_wire`
  (`sdks/python/agenta/sdk/agents/utils/wire.py`).
- The transport ships it: `deliver_subprocess` / `deliver_http` (and the streaming pair) in
  `sdks/python/agenta/sdk/agents/utils/ts_runner.py`. A backend's `_deliver` picks one
  (`sdks/python/agenta/sdk/agents/adapters/in_process.py`, `.../adapters/sandbox_agent.py`).
- The runner (`services/agent/`) drives the harness and the model. This is the only step
  that costs money and flakes.
- The SDK parses the result in `result_from_wire` (same `wire.py`).

So `_deliver` returning a dict is the single seam to cut. Replace what the runner returns
with a recorded dict and the whole SDK path above and below it stays real. Nothing in
`wire.py`, the adapters, the harness translation, or the cold environment lifecycle is faked.

## Tier 1: pure unit (fake ports, no I/O)

What it is: the fakes in `sdks/python/oss/tests/pytest/unit/agents/conftest.py`
(`FakeBackend` / `FakeSandbox` / `FakeSession`) subclass the real ports from
`agenta.sdk.agents.interfaces`. They return a canned `AgentResult` and record every lifecycle
call. Tests assert on translation and lifecycle without a runner, a sandbox, or a model.
`test_harness_adapters.py` and `test_environment_lifecycle.py` live here.

Best-practice grounding:

- This is the base of the agent testing pyramid: "Unit tests with mocked LLM providers
  returning canned responses. Tests retry logic, tool validation, and error handling without
  calling real models."
  ([Block Engineering](https://engineering.block.xyz/blog/testing-pyramid-for-ai-agents))
- Fakes that subclass the real abstract port are the durable form of a test double: when the
  port grows a method, the fake fails to instantiate and the test flags it. This is what
  keeps a mock honest over time, versus a hand-rolled stand-in that silently drifts from the
  interface it imitates. Our `conftest.py` docstring already states this contract; it is
  worth keeping as a rule.
- Component-level isolation is the recommended way to keep a failure attributable: evaluate
  "retrievers, generators, and tool calls independently" so one broken step does not hide
  behind an end-to-end score.
  ([Confident AI](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide))

What belongs in this tier in our repo: anything that asserts a decision the SDK makes before
the wire. Harness translation (Pi keeps built-ins, Claude drops them and gates), forced
Agenta skills and persona, `make_harness` validation, DTO parsing edge cases. These never
need a recorded fixture because there is no model in the decision. Keep them here; do not
promote them to replay tests just because replay is newer.

## Tier 2: wire-contract golden (pin the /run payload shape)

What it is: `test_wire_contract.py` asserts `request_to_wire` against checked-in golden JSON
in `golden/` (`run_request.pi.json`, `run_request.claude.json`, `run_result.ok.json`,
`run_result.error.json`), and asserts `result_from_wire` parses the golden result. The same
files are meant to anchor the TS side (`services/agent/src/protocol.ts`). `KNOWN_REQUEST_KEYS`
is the explicit allowlist of top-level keys; adding a key without adding it to `protocol.ts`
is the drift this set exists to catch.

Best-practice grounding:

- This is contract testing with a shared golden file. The contract "lives" as the golden
  JSON; both language sides verify against it independently. "Comparing against the current
  golden (published) schema ... ensures documentation doesn't drift," and "drift is services
  slowly diverging from the assumptions their callers rely on, and contract tests exist to
  stop this."
  ([Pactflow](https://pactflow.io/blog/contract-testing-using-json-schemas-and-open-api-part-3/),
  [TianPan: contract testing AI pipelines](https://tianpan.co/blog/2026-04-20-contract-testing-ai-pipelines))
- Full Pact-style brokered contract testing is overkill here. We do not have many independent
  consumers negotiating a contract; we have two hand-mirrored serializers (Python `wire.py`
  and TS `protocol.ts`) that must agree byte-for-byte. A shared golden file checked into the
  repo is the right weight: it is the single artifact both sides assert against, with no
  broker and no network.
  ([Codastra: TS contract tests, schemas in CI](https://medium.com/@2nick2patel2/typescript-contract-tests-for-microservices-prevent-drift-with-schemas-in-ci-e1a3d49f886b))
- Snapshot/golden hygiene: golden files are reviewed artifacts, not generated noise. Regenerate
  deliberately and read the diff before committing. Syrupy makes this explicit by failing when
  a snapshot is missing (not only when it differs) and by storing a human-readable, Git-friendly
  serialization so a reviewer can eyeball the change.
  ([Syrupy docs](https://syrupy-project.github.io/syrupy/),
  [Simon Willison TIL](https://til.simonwillison.net/pytest/syrupy))

What belongs in this tier in our repo: the shape of the `/run` request and result, and the
event/capability vocabulary. The golden is hand-written today, which is fine because it is
small and the point is to pin the exact bytes both serializers must produce. The gap worth
closing: the TS side does not yet assert the same golden files. The `protocol.ts` and
`test_wire_contract.py` docstrings both say the TS assertion is "a later PR." Until that lands,
the cross-language contract is only enforced from Python. A `services/agent/test/protocol.test.ts`
that loads `../../sdks/python/oss/tests/pytest/unit/agents/golden/*.json` and checks each
key against `AgentRunRequest` / `AgentRunResult` would close it, using the same
`node:assert` + `tsx` style as the existing `services/agent/test/*.test.ts` (there is no
vitest in this service).

Caution we should adopt from snapshot tooling: do not let golden regeneration become a reflex.
A changed golden is a contract change. The reviewer of a PR that touches `golden/*.json` must
confirm `protocol.ts` and `KNOWN_REQUEST_KEYS` moved with it. Treat a golden diff the way
syrupy users are told to treat a snapshot diff: regenerate, then eyeball, then commit.

## Tier 3: replay (recorded runner response, real SDK, no LLM)

What it is: the integration test in
`sdks/python/oss/tests/pytest/integration/agents/test_transport_roundtrip.py` already runs the
whole SDK path against a fake runner. Today the fake runner is an inline echo script; it proves
the transport and serialization round-trip but it does not assert real model behavior. The
replay tier is the same machinery with one change: the fake runner replays a *captured real
runner response* instead of echoing. The SDK and service run for real; the recorded response
stands in for the model.

Best-practice grounding:

- This is the "reproducible reality" / "record-and-playback" tier. A `TestProvider` wraps the
  real provider in two modes: record (call the model, save request+response keyed by an input
  hash) and playback (skip the model, return the recorded response for matching inputs).
  Recording happens once, on demand; CI only ever plays back.
  ([Block Engineering](https://engineering.block.xyz/blog/testing-pyramid-for-ai-agents))
- What to record, from the agent record-replay literature: the full prompt, sampling
  parameters, model id and version, the exact response, tool name + arguments + the complete
  tool response including errors, and any seeds or env the agent reads. Append-only JSONL is
  the recommended on-disk form for a multi-step trajectory.
  ([arXiv 2505.17716, "LLM Agents with Record & Replay"](https://arxiv.org/html/2505.17716v1),
  [TianPan: deterministic replay](https://tianpan.co/blog/2026-04-12-deterministic-replay-debugging-non-deterministic-ai-agents))
- What to assert: tool-call correctness and trajectory, not prose. "Comparing the tools the
  agent calls to the ideal set of tools required for a given user input" is a deterministic
  check; so is argument validation and plan adherence. These "work without requiring fresh
  model invocations." Assert that the recorded run called the right tool with the right args
  and reached the right stop reason, not that the assistant text matches verbatim.
  ([Confident AI](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide))
- Run replay first as a CI gate: "Running replay first as a CI gate ensures no change passes
  to production without clearing the replay regression suite ... a fast, cheap, deterministic
  safety net."
  ([Block Engineering](https://engineering.block.xyz/blog/testing-pyramid-for-ai-agents))

Where this lives and how it composes in our repo:

- Storage. Captured pairs go under `docs/design/agent-workflows/qa/runs/<cell>.json` per the
  QA README, where a cell is an environment+harness+capability triple (for example
  `e1-pi-gateway-tool.json`). The test fixtures that the replay tests load go under
  `sdks/python/oss/tests/pytest/integration/agents/recordings/`. The `runs/` copy is the raw
  QA artifact; the `recordings/` copy is the redacted, test-shaped fixture. Keep both: `runs/`
  is provenance, `recordings/` is what CI reads.
- Injection point. The cleanest seam is a backend whose `_deliver` returns the recorded dict.
  Two equivalent ways, both already supported by the code:
  - Subprocess replay (matches the existing round-trip test): write a tiny runner script that
    ignores stdin and prints the recorded JSON, then
    `InProcessPiBackend(command=[sys.executable, str(script)], cwd=...)`. This exercises the
    real `deliver_subprocess` transport, so it also guards transport parsing.
  - Direct `_deliver` stub (lighter, no subprocess): construct the backend and
    `monkeypatch` its `_deliver` to return the recorded dict. Faster, but skips the transport
    layer. Prefer the subprocess form for the canonical replay test and the stub form when the
    test is only about parsing or downstream behavior.
- HTTP-transport variant. When the path under test is the HTTP transport (`url=` backend,
  `deliver_http`), `respx` is the right tool: it is an httpx-native mock router, so it
  intercepts the `POST /run` our `deliver_http` makes and returns the recorded body without a
  live runner. It is async-native, which matches our `httpx.AsyncClient` usage.
  ([RESPX guide](https://lundberg.github.io/respx/guide/),
  [rednafi: shades of testing HTTP in Python](https://rednafi.com/python/testing_http_requests/))
- Why not VCR.py here. VCR.py records at the HTTP socket. Our LLM call does not leave the
  runner over an interface the SDK's test process can see; the SDK talks to the runner over a
  subprocess pipe or one `POST /run`. A VCR cassette of `POST /run` would record exactly one
  interaction, which is what a single recorded `runs/*.json` already is, with less machinery.
  VCR.py earns its keep when a layer makes many outbound HTTP calls you want to capture
  transparently (the gateway `/tools/call` round-trips, or any future direct-provider HTTP in
  the SDK). For those, use VCR.py with `record_mode="none"` in CI so a missing or new request
  fails loudly instead of hitting the network, and redact with `filter_headers=['authorization']`
  plus a `before_record_response` scrub.
  ([vcrpy usage](https://vcrpy.readthedocs.io/en/latest/usage.html),
  [vcrpy advanced](https://vcrpy.readthedocs.io/en/latest/advanced.html))

## Controlling nondeterminism: redaction and volatile fields

A recorded `/run` pair carries values that must not be asserted on and must not be committed:

- Secrets. The request `secrets` map holds provider API keys (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, ...), and `trace.authorization` / `toolCallback.authorization` hold
  bearer tokens. Redact to a fixed placeholder (`"REDACTED"` / `"sk-test"`) before storing.
  This mirrors VCR.py's `filter_headers` and `filter_post_data_parameters`, which exist for
  exactly this. Never commit a real key; the golden fixtures already use `sk-test` / `sk-ant`
  placeholders, so match that convention.
  ([vcrpy advanced: filter_headers / filter_post_data_parameters](https://vcrpy.readthedocs.io/en/latest/advanced.html))
- Volatile ids. `trace.traceparent`, the result `traceId`, `sessionId`, and any
  `tool_call.id` are per-run. Pin them to stable placeholders in the fixture, or exclude them
  from the assertion. This is the snapshot-library "built-in matchers for non-deterministic
  data such as IDs or timestamps" idea applied by hand.
  ([Syrupy docs](https://syrupy-project.github.io/syrupy/))
- Timestamps, durations, usage, cost. Do not assert exact values. Assert structure (usage has
  the four keys), or a coarse invariant (`total == input + output`), not a number. Cost and
  token counts shift with model versions.
- Ports and URLs. `toolCallback.endpoint` and the trace `endpoint` carry host:port that change
  per environment. Normalize to a fixed host before storing so the fixture is portable across
  the dev box, CI, and a laptop.

The general rule from the replay literature: redact at record time, not at assert time. Scrub
the volatile fields once when you save the fixture (the VCR.py `before_record_response`
pattern), so the committed file is already clean and every reader of it sees stable values.
([vcrpy advanced: before_record_request / before_record_response](https://vcrpy.readthedocs.io/en/latest/advanced.html))

## Markers and CI placement

Our marker taxonomy (`sdks/python/pytest.ini`, `api/pytest.ini`) already has the right
vocabulary; use it, do not invent markers:

- Replay tests are `integration` (they exercise the real transport) and `cost_free` (no paid
  service). They must never be `llm_required`. The whole point is that they run in the
  default CI lane that excludes `llm_required` and `acceptance`.
- The first-time capture run is the opposite: it is `llm_required` (and usually `acceptance`,
  since it needs a running system per the QA README). Keep capture and replay as separate
  tests so CI runs replay and a human runs capture on demand. This is the "CI validates the
  deterministic layers; humans validate the rest" split.
  ([Block Engineering](https://engineering.block.xyz/blog/testing-pyramid-for-ai-agents))
- Per the literature, replay runs first as a gate. In our terms: the `cost_free` lane
  (Tiers 1, 2, 3) is the blocking gate; `llm_required` acceptance runs are out-of-band.

## How the three tiers compose, end to end

A single captured cell produces tests at all three tiers, and each tier catches a distinct
class of regression:

1. Tier 1 (unit) catches a wrong decision before the wire: Claude stopped dropping built-ins,
   Agenta stopped forcing a skill. No fixture; pure fakes.
2. Tier 2 (golden) catches the two serializers drifting: a renamed key in `wire.py` that
   `protocol.ts` did not follow. The captured request, redacted, can also be diffed against
   `KNOWN_REQUEST_KEYS` to prove a real run emits only known keys.
3. Tier 3 (replay) catches the SDK mis-handling a real runner result: a new event type the
   parser drops, a capability flag that stopped mapping, a tool-call shape the result handler
   no longer carries forward. Real recorded result, fake transport, no model.

The fixture is the through-line. One `runs/<cell>.json` capture, redacted, feeds the golden
diff (Tier 2) and the replay test (Tier 3); the unit tests (Tier 1) stand alone but assert the
same translation that produced the request half of that capture.

## Sources

- [Block Engineering: Testing Pyramid for AI Agents](https://engineering.block.xyz/blog/testing-pyramid-for-ai-agents)
- [Confident AI: LLM Agent Evaluation Complete Guide](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide)
- [arXiv 2505.17716: Get Experience from Practice — LLM Agents with Record & Replay](https://arxiv.org/html/2505.17716v1)
- [TianPan: Deterministic Replay for non-deterministic AI agents](https://tianpan.co/blog/2026-04-12-deterministic-replay-debugging-non-deterministic-ai-agents)
- [TianPan: Contract Testing for AI Pipelines](https://tianpan.co/blog/2026-04-20-contract-testing-ai-pipelines)
- [VCR.py usage (record modes)](https://vcrpy.readthedocs.io/en/latest/usage.html)
- [VCR.py advanced (filtering, matchers, before_record callbacks)](https://vcrpy.readthedocs.io/en/latest/advanced.html)
- [RESPX user guide (httpx mock router)](https://lundberg.github.io/respx/guide/)
- [rednafi: Shades of testing HTTP requests in Python](https://rednafi.com/python/testing_http_requests/)
- [Syrupy snapshot library docs](https://syrupy-project.github.io/syrupy/)
- [Simon Willison TIL: snapshot testing with syrupy](https://til.simonwillison.net/pytest/syrupy)
- [Pactflow: schema-based contract testing](https://pactflow.io/blog/contract-testing-using-json-schemas-and-open-api-part-3/)
- [Codastra: TypeScript contract tests, schemas in CI](https://medium.com/@2nick2patel2/typescript-contract-tests-for-microservices-prevent-drift-with-schemas-in-ci-e1a3d49f886b)
