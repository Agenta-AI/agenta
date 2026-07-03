# Plan: fix the approval boundary

Prerequisites: [the-bug.md](the-bug.md) for the bug,
[design-review.md](design-review.md) for the principles,
[code-review.md](code-review.md) for the correctness debt this plan folds in.

This is a plan, not an implementation. The whole feature is a pre-release POC, so nothing
here preserves backward compatibility: fields get deleted, not deprecated.

## Baseline: this plan builds on PR #5054

Decision (Mahmoud, 2026-07-03): Arda merges #5054 as-is and we rework on top, rather than
splitting a 40-commit PR on an unreleased dev branch. PR #5041 is stacked on his branch,
and this plan treats his changes as the base. Sorting the HITL-relevant pieces of #5054:

- **In the base, kept.** The unique per-turn stream `messageId` plus the frontend
  "already resumed" edge-trigger guard (together these fixed the frontend half of the
  infinite loop, finding M7), the tool-input `{}` display fix, and the `[HITL]` diagnostic
  logging.
- **In the base, deleted by this work.** The `resolvedName` stamping (patches the
  tool-name drift that direct replay makes irrelevant) and the `nonConvergingToolNames`
  loop-breaker (silent auto-deny after three non-converging approvals: keyed by bare tool
  name, false-positive-prone, and it reintroduces the F-024 clobber). Deleting both is an
  explicit phase 1 item; the acceptance tests replace them as the regression guard.
- **In the base, unrelated.** The Turn Inspector and chat UX work. Untouched.

## The permission model (settled in review round 2)

Two levels, one vocabulary, no hidden steps:

- **Per tool**: `permission: allow | ask | deny`, or unset. Unset means "inherit the
  policy". That is the whole per-tool story. The legacy `needs_approval` boolean and the
  `agenta_metadata.permission_mode` alias are **deleted** (Mahmoud: no compat needed).
- **Per agent (the global policy)**: one field with four modes.
  - `allow`: run every tool without asking.
  - `ask`: a human approves every tool call.
  - `deny`: refuse every tool call (lockdown).
  - `allow_reads` (name open, see status.md): reads run, writes ask. Resolved from the
    catalog's `read_only` hint; a tool with no hint counts as a write and asks. This was
    previously an opaque per-tool defaulting step buried in a ladder; Mahmoud's call is
    that "reads are always fine" is a *policy*, so it becomes a visible policy mode. It is
    the sensible default for new agents.

A tool's **effective permission** is simply: its own `permission` if set, else what the
policy mode says for it. ("Effective permission" replaces the earlier term "disposition";
it matches the code's `effective_permission()`.)

## What "fixed" means, concretely

Behavior after the fix, stated as acceptance checks:

1. **`allow` never prompts, anywhere.** A tool whose effective permission is `allow` runs
   in place. Its result streams. No approval event is emitted. Playground and headless
   behave identically.
2. **`ask` always pauses, everywhere.** A tool whose effective permission is `ask` parks
   the turn and emits exactly one approval request. In the playground you get the
   Approve/Deny buttons; approving completes the run **without looping** (broken live
   today, diagnosed: findings M7 + M2). On a headless call the run ends `paused`, and the
   caller can see that.
3. **`deny` never runs, anywhere.** Including client tools (today they bypass it).
4. **The pause is visible on every path.** Batch responses carry the stop reason and, when
   paused, the pending interaction identity. Nobody has to query spans to learn their run
   stopped.
5. **No decision comes from transport metadata.** Deleting a session id changes nothing
   about permissions.

One consequence worth stating up front, because it reframes the original reproduction: the
`uc9-digest` run still pauses at `SEND_MESSAGE` under the default policy, and after the fix
that is an explicit, visible policy outcome rather than an accident. Under `allow_reads`,
`SEND_MESSAGE` is a write (catalog hint, populated at
`sdks/python/agenta/sdk/agents/platform/gateway.py:199`), so it asks. The author who wants
the digest posted headless sets `permission: allow` on that tool, or switches the agent's
policy to `allow`, and the run completes end to end.

## Options considered

(Kept for the record; the recommendation is unchanged since round 1, with the vocabulary
updated by round 2.)

**Option A: the one-line fix.** Consult the policy before parking (`responder.ts:201-206`).
Restores `allow` for everything, including tools that resolved to `ask`: the playground
prompt disappears entirely, and an author's explicit "ask me first" is silently
auto-approved. Rejected.

**Option B: permission-aware responder only.** The responder looks up the gated tool's
`permission` from the run request's tool specs and `hasHumanSurface` dies. Fixes resolved
tools but leaves one hole: authors can write raw `ask` rules for Claude *builtins*
(`Bash`, `Edit`...) via `harness.permissions`, and those exist only inside the rendered
settings file. The responder would see a builtin gate as "unset" and auto-approve it under
a policy of `allow`. An explicit authored "ask" being silently approved is the worst
failure mode on the table. Rejected as an end state.

**Option C: visibility only.** Batch surfaces the paused state. Necessary, not sufficient.

**Option D: one resolved permission plan (recommended, Codex concurred).** The SDK computes
every effective permission once and ships it on the run request; the runner only enforces.
Closes the builtin hole (authored builtin rules travel in structured form), unifies the
relay and the responder on one decision function, and removes both duplicate computations
and the vocabulary split. One shot rather than staged: no compatibility constraints, and
B's responder change is a subset of D's, so a mid-implementation fallback to B+C loses no
work.

## The target design

### One wire contract for permissions

The run request gains one coherent block, replacing the stringly `permissionPolicy`:

```
permissions: {
  default: "allow" | "ask" | "deny" | "allow_reads",  // the global policy (4 modes)
  rules?: [                                           // authored harness-builtin rules
    { pattern: "Bash(rm:*)", permission: "ask" },
    ...
  ]
}
```

Per-tool permissions keep riding where they already are (`customTools[].permission` and
`mcpServers[].permission`); the SDK writes the author's explicit value (or nothing), and
the `read_only` hint already on each spec is what `allow_reads` consults. Semantic roles
stay clean: `permissions` is policy, owned by the author, assembled by the SDK;
`sessionId` goes back to being pure correlation.

The authored config path moves from `runner.interactions.headless` to
`runner.permissions.default` (agent-level authored rules, if any, sit beside it as
`runner.permissions.rules`). Settled in review round 3 on JP's point: these permissions are
enforced by the runner, so they live under the runner scope. They deliberately do not sit
under `interactions`: an interaction is one possible *outcome* of a permission (`ask`),
while `allow` and `deny` never produce one, so `runner.interactions.permissions.*` would
misname two thirds of the values. The run-request block stays `permissions: {...}` because
the whole request already addresses the runner.

### One decision function

```
effectivePermission(gate, plan):
  explicit = plan.toolSpec(gate)?.permission          // resolved tools, MCP servers
           ?? plan.matchRule(gate)                    // authored builtin rules
  if explicit: return explicit                        // allow | ask | deny
  if plan.default == "allow_reads":
    return gate.readOnlyHint == true ? "allow" : "ask"   // no hint counts as a write
  return plan.default                                 // allow | ask | deny

decide(gate, plan):
  perm = effectivePermission(gate, plan)
  if perm == "deny":  return deny
  if perm == "allow": return allow                    // reply "once"; run continues in place
  // perm == "ask":
  stored = storedDecision(gate)                       // the answer from a previous turn
  if stored: return stored (consumed once)
  return pendingApproval                              // pause: no reply, end turn "paused"
```

Order matters, twice over. The effective permission is resolved *before* stored decisions
are consulted, so a stale approval can never override a config that has since changed to
`deny` (today stored decisions are checked first). And a stored decision is consumed on
first match, so one approval authorizes one execution ("once" semantics, code-review M1).

The same function backs both gates: the ACP responder (harness-gated tools) and the relay
(runner-executed tools). Deciding and executing are separate jobs (Mahmoud's review point):
the decision runs *before* execution, in the shared function, and the relay itself carries
no permission logic; it executes calls that were already permitted. The relay's `TODO(S5)`
collapse disappears. Client tools stop being a special case: they resolve through the same
function and simply default to `allow` (their fulfillment *is* the browser interaction), so
`deny` and `ask` work on them with no extra code. `hasHumanSurface` is deleted.
`PolicyResponder` is deleted. An `ask` pause on a headless run is correct behavior: the
turn ends `paused`, visibly, with an interaction row for the future durable-resume flow.

### Resume without matching: replay the approved call

The base (#5054) still resumes by hoping the harness re-issues the gated call with a
matching identity. Both halves of that key drift in practice (name drift observed live,
argument drift latent), which is why the loop-breaker exists in the base at all. This plan
replaces the mechanism: on resume, the runner replays the *approved call itself* (the
exact tool and arguments the human saw and approved) instead of matching a re-issued one.
That removes the reassembled-key fragility class outright, and it is also more correct:
the human approved those arguments, not whatever the model regenerates. With it, the
`resolvedName` patch and the loop-breaker become deletable.

### Events mean actions

`interaction_request(user_approval)` is emitted only when the decision is
`pendingApproval` (today it fires before the decision, so auto-approved gates would emit
false prompts). What ran is already visible through `tool_call`/`tool_result` events.

### The pause is visible on batch

`_agent_batch` returns `stop_reason` alongside the messages and, when paused, the pending
interaction reference (id/token). Exact response shape to be settled against the streaming
work in `../builder-agent-reliability/streaming-invoke/`; the requirement from this side is
only: a paused run must be distinguishable and reference its pending approval.

## Execution phases

Each phase lands green on its own. Sizes are rough.

**Phase 1: the decision core (runner).**
`effectivePermission`/`decide` as one exported module; responder and relay call it; delete
`hasHumanSurface`, `PolicyResponder`, and #5054's `nonConvergingToolNames` loop-breaker +
`resolvedName` stamping; emit approval events only on pause; consume stored decisions once;
implement replay-the-approved-call on resume. Rewrite the responder decision tests as a
generated truth table (effective permission × stored decision × policy mode), replacing the
tests that pin the bug (`responder.test.ts:227-237` and the park-by-default cases; listed
in code-review.md, "Tests that pin behavior the fix will change").

**Phase 2: the wire and the SDK (Python).**
`permissions.{default, rules}` on the run request (typed enum incl. `allow_reads`,
mirrored in `wire.py`, the Python copy of the runner's wire types; golden fixtures
updated). Delete `needs_approval`, the `permission_mode`/`permissionMode` aliases, and the
`agenta_metadata.permission_mode` fallback; `effective_permission()` shrinks to
"explicit or None" with the policy resolution moving into the shared model. Structured
builtin rules derived from the same authored `harness.permissions` lists that feed the
settings renderer, so the two cannot disagree. Claude settings rendering: `allow` still
renders an allow rule, `deny` a deny rule, `ask`/unset still leaves the gate raised; under
`allow_reads`, read-hinted tools render allow rules (this is where "reads never gate on
Claude" is enforced).

**Phase 3: service and frontend.**
Batch surfaces `stop_reason` + pending interaction reference; fix the stream-setup cleanup
leak (code-review M6). Frontend: the "Permission policy" select becomes the four-mode
policy on the renamed field; the tool editor's Permission select stays
allow/ask/deny/inherit and drops the `needs_approval`/legacy-alias fallbacks; no changes to
the approval UI or resume machinery. The agent form also gains the Pi counterpart of the
Claude settings block (review round 3): a Pi settings control exposing builtin selection
(`builtin_names`), rendered only for the Pi harness the way `ClaudePermissionsControl`
renders only for Claude (`useModelHarness.tsx`). Frontend-only: the SDK's
`PiAgentTemplate` already carries `builtin_names` on the wire and the backend stays as is.

**Phase 4: correctness debt in the same code (from code-review.md).**
H1 (reply failure pauses or fails loud; resolve the interaction only after a successful
reply), H2 (only `{approved}` envelopes become decisions; client-tool replay scoped by
interaction token), M3 (approval responses must correlate by `toolCallId`; drop loudly
otherwise; largely absorbed by direct replay), M4 (client tools through the shared
function, defaulting to `allow`), M5 (latch the stop reason before the relay drain), L1
(no-id gates pause instead of silently hanging), H3 (verify the daemon's permission-id
scheme; if per-session counters, namespace interaction tokens with the turn), L2 (reserve
the `agenta-tools` MCP server name in the settings renderer).

**Phase 5: organization cleanup (from code-organization-review.md).**
Extract the park controller from `sandbox_agent.ts` into the `engines/sandbox_agent/`
family; rename `park` → `pendingApproval` internally (wire `stopReason: "paused"` stays);
`permissions.ts` → `acp-interactions.ts`; the four-site permissions map as a header doc;
fix the stale `services/agent/` pointers and pin the `agenta-tools` coupling with a shared
fixture test.

**Phase 6: proof.**
Live matrix on the dev stack (Claude harness, a model with credit):
- headless batch + streaming, policy `allow`: everything runs through; no approval events.
- headless with an `ask` tool (or a write under `allow_reads`): run ends `paused`, batch
  response says so, interaction row exists.
- playground with an `ask` tool: prompt renders, approve resumes and **completes without
  looping** (the live-broken case; reproduce first, fix via direct replay, pin the pass as
  the replay test). Deny resumes and continues without the tool (F-024 and F-036 stay
  fixed).
- playground, policy `allow`: no prompt, tools visibly run ("auto means auto" check).
- Pi: relay enforces the same decisions; relay `ask` pauses (verify the client-tool park
  machinery carries it, else stage relay-ask into its own slice).
- uc9-digest end-to-end: `SEND_MESSAGE: allow` → headless run completes all four tools and
  posts; default `allow_reads` → run pauses visibly at `SEND_MESSAGE`.
Then pin one pause→approve→resume pair as a replay test (`agent-replay-test` skill) and a
producer-side SDK test asserting what `/invoke` actually sends in `sessionId` (the missing
test that let the session-id proxy rot).

## Behavior deltas (before → after)

| Case | Today | After |
| --- | --- | --- |
| Headless, unset tool, policy allow (was auto) | Parks silently; batch hides it | Runs in place |
| Headless, unset write tool, policy `allow_reads` | Parks silently | Pauses visibly (`stop_reason`, interaction ref) |
| Headless, unset read tool, any allow-ish policy | Runs (settings allow rule) | Runs (unchanged, now policy-explained) |
| Playground, unset tool, policy allow | Prompts (park) | Runs, tool activity visible, no prompt |
| Playground, `ask` tool | Prompts; approve can loop forever | Prompts; approve runs the approved call, done |
| `deny` on a client tool | Ignored | Refused |
| Stored approval vs changed-to-deny config | Approval wins | Deny wins |
| One approval, model repeats identical call | Every repeat auto-runs | One approval, one run |
| Claude builtin with authored `ask` rule | Parks | Pauses (rule travels on the wire) |
| Tool with `needs_approval: true` | Treated as ask via ladder | Field deleted; author sets `permission: ask` |
| Approve 3+ times on a non-matching gate | #5054 base: silent auto-deny | Cannot happen (no matching; loop-breaker deleted) |

## Risks and open questions

- **Direct replay of the approved call.** The new mechanism needs one empirical check: the
  cleanest implementation answers the re-raised gate when identity matches, and *injects*
  the approved call's execution when it does not. How Claude behaves when the runner
  executes-and-returns a result for a call it re-issued differently needs the phase 6 live
  loop to pin. Fallback if injection proves harness-fragile: approve the re-raised gate
  but execute with the *approved* arguments (still no key matching).
- **Relay-ask pausing on Pi.** The relay can park client tools today; ordinary relay-tool
  `ask` needs the same turn-boundary treatment (old S5.2). If heavy, ship relay-ask as its
  own slice, documented, while Claude paths use the full design.
- **Rule matching for builtins.** The structured `rules` need a matcher compatible with
  Claude's rule syntax (`Bash(npm run:*)`). Scope it to exactly what the settings renderer
  accepts today.
- **Batch response shape.** Owned jointly with the streaming-invoke workspace; this plan
  only requires that paused be distinguishable.
- **Vocabulary migration.** `auto` → the four-mode policy and the authored-path rename
  touch the FE form, SDK parsing, wire, and fixtures in one PR. POC status makes this
  safe; the golden wire contract test is the safety net.
