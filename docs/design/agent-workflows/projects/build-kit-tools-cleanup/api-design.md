# API design: `test_run` and the `query_spans` stopgap

Status: contract on paper, 2026-07-03. Shaped by [tool-home-options.md](tool-home-options.md)'s
recommendation (Option C: a server-side handler on the tool-call plane). The
design-interfaces skill's role taxonomy is applied throughout: every field is placed by
what it IS (input, policy, context, output, metadata), not by feature.

## What `test_run` is for

The inside builder can commit and schedule, but it cannot verify. The playground chat
covers the interactive case; the runs that matter (scheduled, event-triggered) are
headless, enter through `inputs_fields`, and fail by stopping short while reporting no
errors (the lab's deepest finding). `test_run` is the inside port of the lab's
`test-agent.sh` + `check-tools.sh`: run the config headless once, and return output, the
ordered tool list, approval gates, the resolved config, and a verdict.

## The tool contract (model-visible)

Catalog entry: `op="test_run"`, `handler="test_run"` (Option C mode),
`read_only=False` (it spends tokens and can fire external writes; the approval default
follows from the hint, owned by the approval-boundary model). Context binding:
`workflow_variant_id -> $ctx.workflow.variant.id`, stripped from the model schema like
every binding (`op_catalog.py:126-143`).

Request (what the model sends; roles annotated):

```jsonc
{
  // input: the test stimulus. Frame it as an instruction, not a bare paragraph
  // (lab rule: "Summarize the following text:\n\n...", never just the text).
  "inputs": { "messages": [{ "role": "user", "content": "…" }] },

  // input (change set): optional uncommitted delta to test before committing.
  // Same shape as commit_revision's delta: `set` deep-merges, `remove` deletes paths.
  "delta": { "set": { }, "remove": [ ] },

  // policy (verification criteria): what "pass" means for this test.
  "expectations": { "terminal_tool": "SEND_MESSAGE" },

  // context (server-bound, model never sees it): workflow_variant_id via $ctx.
  // routing/config: none. The run always targets the bound variant's committed
  // revision (plus the delta); the model cannot retarget.
}
```

Response (mirrors the lab script's five lines plus the verdict):

```jsonc
{
  // output: what the run said and did.
  "output": "…",                                       // assembled assistant text; may be empty on a tool-call ending
  "tools": [                                           // ordered, from spans (ground truth)
    { "name": "github__LIST_COMMITS", "called": true, "returned": true },
    { "name": "slack__SEND_MESSAGE",  "called": true, "returned": true }
  ],
  "approvals": ["slack__SEND_MESSAGE"],                // gates the run tripped

  // metadata: what the run actually executed with (the lab's RESOLVED line;
  // a wrong harness/model here is the silent-fallback tell).
  "resolved": { "harness": "claude", "model": "sonnet", "provider": "anthropic",
                "connection_mode": "self_managed" },

  // context handles for follow-up reads.
  "trace_id": "…",
  "test_id": "…",                                      // reserved; see shape decision

  // output (judgment): check-tools.sh semantics.
  "verdict": "pass" | "incomplete" | "unconfirmed" | "failed",
  "verdict_reason": "terminal tool 'SEND_MESSAGE' never ran"
}
```

Verdict semantics, ported from `check-tools.sh` (lab kit, lines 31-37) and the
`test-agent.sh` caveats:

- `pass` - the expected terminal tool executed and returned (when `expectations` given).
- `incomplete` - the run finished without errors but the terminal tool never ran (the
  stopped-short failure; the skill tells the agent to re-test with a blunter numbered
  instruction, see [skills-port.md](skills-port.md)).
- `unconfirmed` - no `expectations` were given, or the terminal tool was called but its
  result is not visible (the gated-write case `check-tools.sh` exists for).
- `failed` - the invoke errored, or tool spans carry error markers.

An empty `output` with a healthy `tools` list is NOT a failure (lab rule: read the TOOLS
line, not just OUTPUT). The description and the skill both say so.

## Server behavior (the Option C handler)

In the tools domain (`core/tools/` service code, dispatched from the tool-call plane):

1. Resolve the bound variant to its committed revision
   (`retrieve_workflow_revision`, the same path triggers use;
   `workflows/service.py:2063-2066` via `_ensure_request_revision`).
2. Apply the optional `delta` in memory (never persisted).
3. Invoke the agent service headless, reusing `_prepare_invoke`'s pattern: sign an
   internal `Secret` token (`workflows/service.py:2054-2062`), POST
   `{service_url}/invoke`. Prefer the streaming accept and drain, so tool calls and
   approval gates come from the event stream (what `test-agent.sh` parses); fall back to
   a spans query when the stream lacks them.
4. Query `POST /api/spans/query` (route: `tracing/router.py:97-98`) for the run's trace,
   with the lab's retry (spans flush a second or two late).
5. Digest into the response above. Pull `resolved` from the trace the way
   `test-agent.sh` does.

### Guards

- **Recursion.** Two layers. First, the natural one: the child run executes the
  committed config, and the build-kit overlay is excluded on commit, so the child
  normally carries no platform tools at all. Second, explicit: the handler marks the
  child invoke with `meta.run_kind = "test"`; the agent service surfaces that in the
  child's `RunContext` (a `run.is_test` flag is a natural extension of
  `protocol.ts:174-185`), and the handler refuses a `test_run` whose own run context says
  the run is itself a test. Depth is therefore capped at one, even if an author commits
  platform tools deliberately or tests a delta that adds them.
- **Duration.** A server-side cap on the child run (recommend 120s to start; lab runs
  finished well under 60s). See the shape decision for how the cap interacts with the
  runner's timeouts.
- **Write reality.** `test_run` does not sandbox the child's tools: a test run that
  reaches `SEND_MESSAGE` really sends the message. The description must say so, and the
  skill tells the agent to warn the user (same convention as `test_subscription`'s
  blocking behavior note in the tools-review).

## Shape decision (open decision 2) {#shape-decision}

The three candidates, with the timeout facts from [research.md](research.md) gotcha 3
(`TOOL_CALL_TIMEOUT_MS` 30s, `RELAY_TIMEOUT_MS` 60s):

| Shape | What it means | Cost | Risk |
|---|---|---|---|
| **Sync + delta** | One call returns the digest; `delta` enables test-before-commit. | Per-op `timeout_ms` on the catalog entry, threaded onto the spec and honored by the tool-call fetch AND the relay loop. | A run over the cap loses its digest; mitigate by returning `trace_id` early is impossible in one round-trip, so the recovery is `query_spans`. |
| **Committed-only** | Same, without `delta`. | Same timeout plumbing; slightly simpler handler. | Loses the try-then-commit loop, which the lab's update-agent gap flags as the natural workflow (part 1, "Update the agent config" row). |
| **Async pair** | `test_run` returns `test_id` immediately; a `get_test` op polls. | Two ops in the overlay budget, state for test records, and the model must drive a poll loop (a known wander risk for exactly the agents this tool serves). | Lowest timeout risk. |

**Recommendation: sync + delta, with the cap, plus the escape hatch designed in.** The
response reserves `test_id`; if real usage hits the cap, the async pair is an additive
change (the sync call starts returning early with `status: "running"` and the poll op
ships), not a redesign. The lab evidence says sync fits today, and one tool call is the
shape the model handles most reliably.

## The `query_spans` stopgap (open decision 3) {#the-query_spans-stopgap}

A read op over the existing spans query, shippable regardless of, and before, `test_run`:

```python
PlatformOp(
    op="query_spans",
    description=(
        "Query the spans of a trace in this project (your own runs and your "
        "trigger fires). Use it to verify which tools a run actually executed."
    ),
    method="POST",
    path="/api/spans/query",
    input_schema=...,   # filtering.conditions (trace_id is the primary filter), windowing
    read_only=True,
)
```

This is `check-tools.sh` as a tool: span-level ground truth on whether a run reached its
terminal tool, usable on schedule fires via `list_deliveries` -> `query_spans`. It is a
pure data add (one catalog entry, one overlay-list entry, tests, docs). It does not
depend on the tool-home decision at all.

**Recommendation: ship it now**, as the first slice of the single PR. It delivers most of
the verification value while `test_run` goes through the home decision and the wire
change, and it stays useful after `test_run` lands (reading back a SCHEDULED run's spans
is `query_spans`' job even then; `test_run` only covers the pre-scheduling check).
Overlay budget: with the cuts, core goes from 8 to 9 tools; still inside the target.

Trim the raw response if needed: the spans payload is large. If the first live test shows
the model drowning, add a server-side projection (`fields` allowlist) to the op's schema
rather than a new endpoint.

## How the contract changes under the other homes

- **Option A (gateway-style)**: identical model-visible contract. The spec carries
  `callRef: "tools.agenta.test_run"` and the same context binding; only the catalog's
  internal mode differs. This is why A and C are runtime-equivalent.
- **Option B (runner composite)**: the request/response stays, but verdict rules, span
  digesting, and the retry live in TypeScript; `resolved` comes from the runner's own
  view instead of the trace; and the invoke needs a new `/api`-side route or a loosened
  SSRF guard first. The recursion guard weakens (the runner cannot mark the child run's
  meta without new service support).
- **Option D (composite endpoint)**: the same contract becomes the body of
  `POST /api/workflows/test`, and the catalog wraps it as a plain single-endpoint op with
  `context_bindings` on `workflow_revision.workflow_variant_id`. Model-visible shape
  unchanged; the difference is only where the composition lives and what the public API
  looks like.
