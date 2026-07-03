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
- **In the base, deleted by this work.** The `resolvedName` stamping (the recorded-name
  correlation behind it is right and moves into the decision module; mutating the ACP
  object goes) and the `nonConvergingToolNames` loop-breaker (silent auto-deny after
  three non-converging approvals: keyed by bare tool name, false-positive-prone, and it
  reintroduces the F-024 clobber). Deleting both is an explicit phase 2 item; the
  acceptance tests replace them as the regression guard.
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

### Resume: same-call matching, made robust and honest

An earlier draft of this plan promised "replay the approved call directly, no matching".
The Codex pre-implementation review killed that, and it was right: for Claude-native
builtins the runner's only lever is the ACP reply (`respondPermission`), so it cannot
execute `Bash` or `Edit` itself, and the prior-turn transcript replays as text, not as
structured tool injection. Matching a re-raised gate is unavoidable on that path. What
this plan does instead is make the match robust and its failure honest, per executor:

- **Runner-executed tools (relay: gateway, code, client; everything custom on Pi).** The
  tool name is the spec's own `name`, which cannot drift; the args are canonicalized on
  both sides. A stored approval that matches executes; args that differ are a different
  call and pause for a fresh approval.
- **Harness-gated tools (Claude builtins).** The gate's name anchor is the name already
  recorded for that tool-call id in this turn's `tool_call` event (the mechanism behind
  #5054's `resolvedName` patch, kept but moved inside the decision module instead of
  stamped onto the ACP object); args are canonicalized the same way. Match approves the
  gate with `once`; a mismatch is a new call and pauses for a fresh approval.
- **In every drift case the outcome is a visible re-prompt, never a silent re-park and
  never an auto-deny.** The user sees a new approval request with the new arguments. That
  deletes the loop-breaker (silent auto-deny after 3) without leaving the loop possible:
  the old loop was the *same* call failing to match itself because the key used Claude's
  drift-prone display title; with stable anchors the same call matches, and a genuine
  mismatch means the model actually asked for something different, which a human should
  see.

Stored decisions stay consume-once, and a config changed to `deny` beats any stored
approval (the decision function resolves the effective permission first).

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

Each phase lands green on its own. Sizes are rough. The order is wire-first (a Codex
review point): the runner learns the new `permissions` block and keeps a small
`permissionsFromRequest()` legacy mapping (old `permissionPolicy` in, plan out) so runner
and SDK never disagree mid-arc; the mapping and the legacy field are deleted in phase 5.

**Phase 1: the wire and the decision core (runner).**
`permissions: {default, rules?}` lands on `protocol.ts` (legacy `permissionPolicy` still
accepted, mapped by `permissionsFromRequest()`), mirrored in `wire.py` with goldens
updated. One new pure module owns the decision: gate descriptor in (executor kind, stable
tool name, spec/server permission, read-only hint, canonical args), effective permission
and verdict out, as `effectivePermission`/`decide`. A single pending-approval latch lives
beside it: with parallel gates in one turn, exactly one wins, emits, and pauses; later
gates this turn get no event (today emission and reply race). Truth-table unit tests
(default mode × explicit permission × read-only hint × rule match × stored decision).

**Phase 2: runner enforcement.**
Both gates become lookups. The ACP responder (`ApprovalResponder`, replacing
`HITLResponder` + `PolicyResponder`) answers by effective permission; `ask` consults
stored decisions (same-call match per the resume section, consume once) and otherwise
pauses. `attachPermissionResponder` consults first and emits `interaction_request` only
on pause; interaction rows are created on pause only. The relay stops carrying permission
logic (`resolvePermission` deleted): verdicts come from the shared function, relay `ask`
pauses through the generalized park machinery (this is Pi's HITL), stored approvals
execute on exact match. Delete `hasHumanSurface`, the loop-breaker, `resolvedName`
stamping (the recorded-name correlation moves into the gate-descriptor builder). Rewrite
the responder tests that pin the bug (`responder.test.ts:227-237`, park-by-default cases).

**Phase 3: SDK assembly (Python).**
The SDK assembles the permission plan and ships it. Delete `needs_approval`, the
`permission_mode`/`permissionMode` aliases, and the `agenta_metadata.permission_mode`
fallback; `ToolSpec.to_wire()` carries only the author's explicit `permission` (the
`read_only` hint rides separately; the runner resolves defaults). Wire `rules` are
derived from the same parsed `harness.permissions` lists that feed the Claude settings
renderer, so the two cannot disagree; authored rules that target non-builtin subjects
(`mcp__*`) stay settings-only and are excluded from the wire rules, documented. Claude
settings rendering: `allow` renders an allow rule, `deny` a deny rule, `ask`/unset leaves
the gate raised; under `allow_reads`, read-hinted tools render allow rules (this is where
"reads never gate on Claude" is enforced). Pi templates stop hardcoding
`permissionPolicy: "auto"` and ship the same permissions block as Claude. The authored
schema moves to `runner.permissions.default` (`sdks/python/agenta/sdk/utils/types.py`,
replacing `runner.interactions.headless`).

**Phase 4: service and frontend.**
Batch surfaces `stop_reason` + pending interaction reference; fix the stream-setup cleanup
leak (code-review M6). Frontend: the "Permission policy" select becomes the four-mode
policy on the renamed field; the tool editor's Permission select stays
allow/ask/deny/inherit and drops the `needs_approval`/legacy-alias fallbacks; no changes to
the approval UI or resume machinery. The agent form also gains the Pi counterpart of the
Claude settings block (review round 3): a Pi settings control exposing builtin selection
(`builtin_names`), rendered only for the Pi harness the way `ClaudePermissionsControl`
renders only for Claude (`useModelHarness.tsx`). Frontend-only: the SDK's
`PiAgentTemplate` already carries `builtin_names` on the wire and the backend stays as is.

**Phase 5: correctness debt + cleanup (from the two review docs).**
Correctness: H1 (reply failure pauses or fails loud; resolve the interaction only after a
successful reply), H2 (only `{approved}` envelopes become decisions; client-tool replay
scoped by interaction token), M3 (approval responses must correlate by `toolCallId`; drop
loudly otherwise), M4 (client tools through the shared function, defaulting to `allow`),
M5 (latch the stop reason before the relay drain), L1 (no-id gates pause instead of
silently hanging), H3 (verify the daemon's permission-id scheme; if per-session counters,
namespace interaction tokens with the turn), L2 (reserve the `agenta-tools` MCP server
name in the settings renderer). Organization: extract the park controller from
`sandbox_agent.ts` into the `engines/sandbox_agent/` family; rename `park` →
`pendingApproval` internally (wire `stopReason: "paused"` stays); `permissions.ts` →
`acp-interactions.ts`; the four-site permissions map as a header doc; fix the stale
`services/agent/` pointers. Deletions: the legacy `permissionPolicy` wire field, the
`permissionsFromRequest()` legacy mapping, `needsApproval` on the wire spec, goldens
updated to final shape. `SANDBOX_AGENT_DENY_PERMISSIONS` survives as the operator
kill-switch (forces `default: deny`), documented where it is read. Also sweep the general
agent-workflows docs for the old vocabulary (`auto`, `needs_approval`,
`runner.interactions.headless`, `hasHumanSurface`) and the other surfaces Codex flagged:
`web/packages/agenta-playground/src/state/execution/agentRequest.ts`,
`web/oss/src/components/AgentChatSlice/assets/transport.ts`, `wire_models.py`, generated
client types.

**Phase 6: proof.**
Live matrix on the dev stack (Claude harness, a model with credit):
- headless batch + streaming, policy `allow`: everything runs through; no approval events.
- headless with an `ask` tool (or a write under `allow_reads`): run ends `paused`, batch
  response says so, interaction row exists.
- playground with an `ask` tool: prompt renders, approve resumes and **completes without
  looping** (the live-broken case; reproduce first, verify the stable-anchor match, pin
  the pass as the replay test). Deny resumes and continues without the tool (F-024 and
  F-036 stay fixed).
- playground, policy `allow`: no prompt, tools visibly run ("auto means auto" check).
- an approve where the model re-issues *different* args on replay: a fresh prompt appears
  with the new args (no silent loop, no auto-deny, no blind approval).
- Pi: relay enforces the same decisions; relay `ask` pauses (verify the client-tool park
  machinery carries it, else stage relay-ask into its own slice).
- uc9-digest end-to-end: `SEND_MESSAGE: allow` → headless run completes all four tools and
  posts; default `allow_reads` → run pauses visibly at `SEND_MESSAGE`.
Then pin one pause→approve→resume pair as a replay test (`agent-replay-test` skill) and a
producer-side SDK test asserting what `/invoke` actually sends in `sessionId` (the missing
test that let the session-id proxy rot).

## Test plan

The principle: every behavior in the deltas table below gets a test that fails on today's
code, and every past regression in this area (F-024, F-036, F-040, F-046, the M2/M7 loop)
keeps a named pinning test. By layer:

**Runner unit (vitest, `services/runner/tests/unit/`).**
- A *generated* truth table over the decision function: default mode (4) × explicit
  permission (allow/ask/deny/unset) × read-only hint (true/false/absent) × rule match
  (allow/ask/deny/none) × stored decision (allow/deny/none). Every cell asserted; this
  replaces the tests that pin the bug.
- Precedence pins: explicit tool permission beats a rule beats the default; a config
  `deny` beats a stored approval; a stored decision is consumed exactly once.
- The pending-approval latch: two gates raised concurrently → exactly one
  `interaction_request`, one pause; the loser produces no event.
- Same-call matching: canonical-args stability (key order, absent args, non-JSON fails
  closed; the existing `parkedCallKey` cases carry over), recorded-name correlation for
  ACP gates, spec-name anchoring for relay tools, drift → pause (never deny, never blind
  approve).
- Relay behavior: `ask` pauses without executing; a stored approval executes exactly once
  (no double execution); `deny` refuses with the refusal text; client tools default
  `allow` and honor `deny`/`ask` (M4).
- Events mean actions: `allow`/`deny` verdicts emit no `interaction_request`.
- The phase 5 debt, each as a test: reply failure pauses instead of hanging (H1), only
  `{approved}` envelopes become decisions (H2), stop reason latched before the relay
  drain (M5), a no-id gate pauses (L1).
- `permissionsFromRequest()`: legacy `permissionPolicy` maps correctly until phase 5
  deletes it; after phase 5, the goldens pin its absence.

**Wire contract (golden fixtures, both sides).** `permissions.{default, rules}` appears
in `run_request.claude.json` and `run_request.pi_core.json`; final goldens pin that
`permissionPolicy` and `needsApproval` are gone. The TS compile-time key guard catches a
drifted `protocol.ts`.

**SDK unit (pytest, `sdks/python/oss/tests/pytest/unit/agents/`).**
- Plan assembly: `runner.permissions.default` parses all four modes and rejects unknowns;
  wire `rules` and rendered settings rules come from one parse and cannot disagree
  (asserted by comparing both outputs for the same authored config); `mcp__*`-targeted
  authored rules stay settings-only.
- `ToolSpec.to_wire()` ships only the author's explicit permission; `read_only` rides
  separately; `needs_approval` and the aliases no longer parse.
- Claude settings rendering under each policy mode, including `allow_reads` → allow rules
  for read-hinted tools only.
- Pi templates ship the same permissions block (no hardcoded `"auto"`).
- The producer-side pin the old bug lacked: a test asserting exactly what `/invoke` sends
  in `sessionId`.

**Service (pytest, `services/oss/tests/`).** Batch responses carry `stop_reason`; a
paused run is distinguishable and names its pending interaction; a completed run is
unchanged.

**Frontend (vitest).** The policy select writes the four-mode `runner.permissions.default`
(for Pi too); the tool Permission select has no `needs_approval` fallback; the Pi settings
block writes `builtin_names`.

**Live (phase 6).** The matrix above, plus one pause→approve→resume pair pinned as a
replay test (`agent-replay-test` skill).

## Behavior deltas (before → after)

| Case | Today | After |
| --- | --- | --- |
| Headless, unset tool, policy allow (was auto) | Parks silently; batch hides it | Runs in place |
| Headless, unset write tool, policy `allow_reads` | Parks silently | Pauses visibly (`stop_reason`, interaction ref) |
| Headless, unset read tool, any allow-ish policy | Runs (settings allow rule) | Runs (unchanged, now policy-explained) |
| Playground, unset tool, policy allow | Prompts (park) | Runs, tool activity visible, no prompt |
| Playground, `ask` tool | Prompts; approve can loop forever | Prompts; approve matches on stable anchors and runs, done |
| `deny` on a client tool | Ignored | Refused |
| Stored approval vs changed-to-deny config | Approval wins | Deny wins |
| One approval, model repeats identical call | Every repeat auto-runs | One approval, one run |
| Claude builtin with authored `ask` rule | Parks | Pauses (rule travels on the wire) |
| Tool with `needs_approval: true` | Treated as ask via ladder | Field deleted; author sets `permission: ask` |
| Approve, model re-issues different args on replay | #5054 base: silent auto-deny after 3 rounds | Visible fresh prompt with the new args (loop-breaker deleted) |

## Risks and open questions

- **Arg regeneration on cold replay.** With stable name anchors, the residual drift risk
  is the model regenerating slightly different *arguments* for the same intended call
  (e.g. whitespace in a bash command). The design's answer is a visible fresh prompt,
  which is safe but could annoy if it happens often. The phase 6 live loop measures
  whether it happens in practice; if it does, the loosening lever is a documented
  per-field canonicalization (never name-only matching, which is the HITL bypass).
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
