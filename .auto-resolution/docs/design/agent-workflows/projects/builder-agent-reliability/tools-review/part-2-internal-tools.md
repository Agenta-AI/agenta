# Part 2: the inside platform ops

Inside Agenta, the playground agent gets 18 platform ops plus the `request_connection`
client tool (19 tools total). `overlay.py` injects all of them unconditionally into the
playground agent template, along with the getting-started skill and permissive sandbox
write/execute. The guidance is split across four skills (`build-your-first-app`,
`discover-and-wire-tools`, `set-up-triggers`, and the getting-started skill). Unlike the
outside kit, these ops are self-targeting: the agent can act only on itself.

This is the inside half of a two-part review. Part 1 covers
[the outside build-agent scripts](part-1-external-tools.md). The
[README](README.md) has the TL;DR, the open questions, and the agreed changes.

## How a platform op works, end to end

**Catalog entry.** `sdks/python/agenta/sdk/agents/platform/op_catalog.py` defines
`PlatformOp`, a frozen Pydantic model validated at import: `op` (the model-visible tool
name), `description`, `method` (GET/POST/DELETE only), `path` (relative to the API origin),
exactly one of `input_schema` (inline JSON Schema, may use `x-ag-type-ref` into
`CATALOG_TYPES`) or `input_schema_ref`, `context_bindings`, `args_into`, and a `read_only`
hint. `PLATFORM_OPS` is a dict of 18 entries.

**Model-facing schema.** `resolved_input_schema()` expands type refs, then strips every
`context_bindings` field (and its `required` entry) from the schema. The model never sees
the self-targeting fields.

**`$ctx` bindings.** `context_bindings` maps a dotted body path to a `$ctx.<key>` token,
e.g. `commit_revision` binds `workflow_revision.workflow_variant_id` to
`$ctx.workflow.variant.id`. The runner resolves tokens against the run's context at
dispatch and fills them last, so a bound field always beats the model's args. An
unresolvable binding is a hard failure, not a silent drop. This is the self-targeting
guarantee: the agent can only commit to itself, annotate its own trace, schedule itself.

**Approval.** The catalog carries only the `read_only` hint (no hint counts as a write).
Writes default to ask under the permission plan; the author can override per tool via
`permission` in the config. The mutating ops' descriptions say "Requires approval" so the
model expects the gate.

> **Coordination note (Mahmoud, 2026-07-03):** another agent owns the approval-boundary
> workstream and is actively changing this area (permission plan, `needs_approval`,
> `op_catalog` approval fields). This cleanup must not touch approval semantics without
> talking to that agent first (via the agent-coordination board).

**Execution.** No `/tools/call` hop. The SDK resolver
(`platform/platform_tools.py`, `AgentaPlatformToolResolver`) turns each config entry into
a `CallbackToolSpec` carrying a direct `call` descriptor plus a `ToolCallback` holding the
API base and the caller's credential. The runner
(`services/runner/src/tools/relay.ts` -> `tools/direct.ts`) then makes one HTTP round-trip:
`assembleBody` merges model args (at `args_into`) then static body then `$ctx` bindings;
`directCallUrl` substitutes `{id}` path params, rejects traversal, host-locks the resolved
URL to the run's own Agenta origin, and confines the path to the `/api` mount;
`callDirect` sends the request with the caller's credential and returns the response body
verbatim to the model.

**Adding a new op** is a data add: one `PlatformOp` entry. `overlay.py` iterates
`PLATFORM_OPS`, so every new op automatically ships to every playground agent. That also
means keep/cut decisions are overlay decisions, not delete-the-code decisions.

**The hard constraint.** An op wraps exactly one existing HTTP endpoint: same origin,
under the `/api` mount, GET/POST/DELETE, one request/response. No composition, no polling,
no streaming, no reach into `/services/*`. Anything composite (like a self-test) needs a
new API endpoint first.

## Verdicts on the inside platform ops

Evidence base: the same lab runs behind part 1's outside verdicts (see there for detail):
the capstone used discover-tools, create-agent, test-agent (x2), check-tools (x2),
create-schedule, and triggers-schedules; nothing else got used in a passing run.

The two renames below are decided: hard migrate, no aliases, since the product is
pre-production and there is no backward-compat obligation. See the README's agreed
changes for the date and decision reference.

| Tool | Verdict | Reason |
|---|---|---|
| `find_capabilities` | **keep, hard-migrate to `discover_tools`** (no aliases, decided) | Used in every tool-wiring lab case; discovery is load-bearing. Fix the approximate action matching at the source. |
| `find_triggers` | **keep, hard-migrate to `discover_triggers`** (no aliases, decided) | Needed for event asks; lab shows it mis-matches (Telegram -> Slack event), so tighten, do not cut. |
| `request_connection` | **keep** | The inside equivalent of the outside "stop and ask"; the connect handoff is the one thing only a human can do. |
| `list_connections` | **demote** (drop from default overlay) | Discover responses already carry per-integration connection state; no lab run needed a separate list. |
| `query_workflows` | **cut from overlay** | What it does: wraps `POST /api/workflows/query` to search the project's existing workflow artifacts (agents, prompts) so the builder can reuse work instead of duplicating it. Zero usage evidence in any lab run; "check what exists" never gated a successful build. Keep the op in the catalog for opt-in. |
| `commit_revision` | **keep** | The whole point of the inside builder: apply the config. Self-targeting binding is right. |
| `annotate_trace` | **keep** | Cheap, additive, auto-allow; closes lab case 3 (self-reflection). |
| `create_schedule` | **keep** | Used in both schedule cases; the capstone scheduled cleanly. |
| `list_schedules` | **keep** | The lab's own loop verifies creation by listing (`triggers.sh schedules` after create). |
| `remove_schedule` | **keep** | Cleanup and retry path (case 7 create/list/remove all clean). |
| `create_subscription` | **keep (event asks only)** | Needed to finish an event ask; never completed in the lab only because connections were missing. |
| `list_subscriptions` | **merge into `list_deliveries` or keep as pair with create** | No usage evidence; keep only if subscriptions stay. |
| `list_deliveries` | **keep** | The only way to see whether a trigger actually fired; the headless verify read. |
| `test_subscription` | **keep** (revised per Mahmoud, 2026-07-03) | "Never exercised" was a limitation of the test scenarios (no lab case had a connected event source), not evidence against the tool. It is the only way to verify an event wiring end to end without waiting for a real fire. Design note: it blocks on a real external event, so the skill should tell the agent to warn the user before calling it in a chat turn. |
| `remove_subscription` | **keep** | Same cleanup rationale as `remove_schedule`. |
| `pause_schedule` / `resume_schedule` | **cut from overlay** (agreed) | Lifecycle management, not building. The UI has toggles. No usage evidence, and each unused tool is context cost plus a wander target (the capstone showed extra visible tools derail runs). |
| `pause_subscription` / `resume_subscription` | **cut from overlay** (agreed) | Same. |

Net: the trigger family shrinks from 13 ops to 8 (discover, create x2, list schedules,
deliveries, remove x2, test_subscription). The pause/resume/remove question splits
cleanly: removes earn a place (retry/cleanup, proven outside), test_subscription stays
(the end-to-end event verify), pause/resume do not (manage surface, not build surface).

## Where do logic-bearing tools live? (OPEN, research in progress)

Mahmoud asked: for missing internal tools that include logic, like `test_run`, can we ship
them as gateway tools instead of platform tools?

The review's first answer was "no; put the composite logic behind one new `/api` endpoint
and wrap it as a thin platform op." Mahmoud rejected that framing (2026-07-03): `test_run`
is a **tool**, and it is wrong to make the API non-atomic (add a composite endpoint) just
because the current platform-op plumbing can only wrap one atomic endpoint. The design
constraint should bend, not the API surface.

So the question is open and goes into the internal-tools design research. Directions to
evaluate there, each with its trade-offs:

1. **Give gateway (or a sibling executor) access to run context.** Research whether the
   relay layer can inject `$ctx` bindings into gateway tool calls the way it does for
   platform ops, so a logic-bearing tool can be self-targeting without a new endpoint.
2. **Let the runner compose.** Extend the platform-op dispatcher (runner side) to support
   multi-step ops: invoke, then poll the trace, then digest, all client-side of the API,
   keeping every API endpoint atomic.
3. **A dedicated executor kind for internal logic tools** (neither gateway-external nor
   single-endpoint platform), with run context and Agenta-internal auth as first-class.
4. **The composite endpoint** (the original proposal), kept for comparison.

Constraints any answer must respect: the self-targeting guarantee (the agent tests and
commits only itself), credential separation (Agenta-internal auth must not live in the
user connections system), and approval semantics (coordinate with the approval-boundary
agent before touching that layer).

## The `test_run` gap

### The gap

Inside Agenta the builder cannot test what it built, and cannot verify a run. Outside,
`test-agent.sh` + `check-tools.sh` are exactly the tools that made the lab loop close.
Every lab pass ended with a verified invoke; the shipped inside kit ends at
`commit_revision` and hopes.

### Does the playground chat make self-test unnecessary?

Partially, and only in the interactive case. In the playground the author watches the run
live: output, tool calls, approvals. Re-running the current chat config as a "test" adds
nothing there. But the playground run is not the run that matters. The scheduled and
event-triggered runs are headless: different entry (`inputs_fields` mapping), no human to
approve a gated write, and the lab's deepest finding is that exactly these multi-tool
headless runs stop short while reporting no errors. What the author cannot see in the chat
is how the **committed** config behaves headless. So `test_run` is not redundant inside;
its job is "verify the committed config as a headless run before you schedule it," plus
"read back whether the scheduled run actually reached its terminal tool"
(`list_deliveries` + spans).

### Why it cannot be composed from existing ops, and the `query_spans` stopgap

A platform op is one same-origin request under `/api`. One piece of the old composition
dropped out: since #5064 (invoke negotiation), a non-streaming invoke returns the full
turn, so stream parsing is no longer needed. What remains still exceeds a
single-endpoint descriptor: an invoke on the agent **service** mount
(`/services/agent/v0/invoke`, outside `/api`, so `directCallUrl` rejects it), a retried
spans fetch, and a verdict digest. The conclusion stands. Two ways in:

1. **Stopgap, pure data add today:** a read op `query_spans` over `POST /api/spans/query`
   (what `check-tools.sh` wraps). Gives the inside agent span-level verification of its
   own past runs and its schedule fires. Cheap, read-only, no new endpoint.
2. **The real fix: one new composite endpoint** the op can wrap.

### `test_run` endpoint sketch

- **Route:** `POST /api/workflows/test` (API layer `apis/fastapi/workflows/`, service
  orchestration in `core/workflows/`).
- **Request:**

  ```jsonc
  {
    "workflow_revision": {
      "workflow_variant_id": "…",      // ctx-bound to $ctx.workflow.variant.id, stripped from the model schema
      "delta": { "set": {…}, "remove": […] }   // optional: test an uncommitted change
    },
    "inputs": { "messages": [{ "role": "user", "content": "…" }] },
    "expectations": { "terminal_tool": "SEND_MESSAGE" }   // optional
  }
  ```

- **Server behavior:** hydrate the committed revision (reuse the same
  `_ensure_request_revision` path triggers use), apply the optional delta in memory,
  invoke the agent service server-side (one non-streaming call returns the full turn
  since #5064), query the spans, and return a digest. This is `test-agent.sh`
  productized.
- **Response** (mirrors the script's five lines):

  ```jsonc
  {
    "output": "…",
    "tools": [{ "name": "github__LIST_COMMITS", "called": true, "returned": true }, …],
    "approvals": ["slack__SEND_MESSAGE"],
    "resolved": { "harness": "claude", "model": "sonnet", "provider": "anthropic", "connection_mode": "self_managed" },
    "trace_id": "…",
    "verdict": "pass" | "incomplete" | "unconfirmed" | "failed"   // check-tools.sh semantics when expectations given
  }
  ```

- **Catalog entry:** `op="test_run"`, POST, `context_bindings` on
  `workflow_revision.workflow_variant_id`, `read_only=False` (it spends tokens and can
  fire external writes), so it defaults to approval. The delta field makes
  test-before-commit possible: try the change, then `commit_revision`.
- **Guards to design in:** a recursion stop (the child run must not carry `test_run`,
  or the server refuses a test spawned from a test, via a run-context flag); a server-side
  duration cap, since a direct tool call is one round-trip under the runner's tool
  timeout. If real runs exceed the cap, split into `POST /api/workflows/test` returning a
  `test_id` plus a `GET /api/workflows/test/{id}` poll op. Start synchronous with a cap;
  the lab's runs finished in well under a minute.

## Recommended inside set

One capability, one name, two forms. Inside names use `lower_snake`, outside scripts use
the same words with dashes.

**Core (always in the overlay, 8 tools inside):**

| Name | Purpose | Inside | Outside |
|---|---|---|---|
| `discover_tools` | find integration actions + connection state | hard migrate from `find_capabilities` (no aliases) | `discover-tools.sh` |
| `request_connection` | hand the connect step to the human | existing client tool | no script; the stop-and-ask rule |
| `commit_revision` | apply the config (self) | existing op | (outside creates instead: `create-agent.sh` / `build.sh`) |
| `test_run` | run headless + verify (output, ordered tools, approvals, resolved, verdict) | **new op + new endpoint** | `test-agent.sh` (with `check-tools.sh` as span fallback) |
| `annotate_trace` | record self-reflection on the run | existing op | reference only |
| `create_schedule` | cron trigger | existing op | `create-schedule.sh` |
| `list_schedules` | confirm the schedule exists | existing op | `triggers.sh schedules` |
| `remove_schedule` | retry / cleanup | existing op | `triggers.sh rm-schedule` |

**Event pack (5 more, ideally only when the ask is event-driven):**
`discover_triggers` (hard migrate from `find_triggers`, no aliases), `create_subscription`,
`list_deliveries`, `test_subscription` (kept per Mahmoud 2026-07-03: the end-to-end event
verify; the never-used data point was a test-scenario limitation), and
`remove_subscription`. Outside: `discover-triggers.sh` and
`triggers.sh deliveries|rm-subscription`; add `create-subscription.sh` (agreed 2026-07-03).

**Cut or demoted:** `pause_schedule`, `resume_schedule`, `pause_subscription`,
`resume_subscription` (manage surface, not build surface), `query_workflows`,
`list_connections`, `list_subscriptions` (fold into the deliveries read or keep only with
the event pack). All stay in the catalog; they leave the default overlay.

That takes the inside builder from 19 visible tools to 13 (8 without an event ask), which
is close to what the lab evidence says the job needs. The capstone finding cuts both ways:
fewer visible tools is itself a reliability fix, because the observed failure mode is the
run wandering into tools it never needed.
