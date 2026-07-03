# Plan: fix the approval boundary

Prerequisites: [the-bug.md](the-bug.md) for the bug,
[design-review.md](design-review.md) for the principles,
[code-review.md](code-review.md) for the correctness debt this plan folds in.

This is a plan, not an implementation. The whole feature is a pre-release POC, so nothing
here preserves backward compatibility.

## What "fixed" means, concretely

Behavior after the fix, stated as acceptance checks:

1. **`auto`/`allow` never prompts, anywhere.** A tool whose resolved permission is `allow`,
   or an unset tool under a default of `allow`, runs in place. Its result streams. No
   approval event is emitted. Playground and headless behave identically.
2. **`ask` always pauses, everywhere.** A tool whose resolved permission is `ask` parks the
   turn and emits exactly one approval request. In the playground you get the Approve/Deny
   buttons, as today. On a headless call the run ends `paused`, and the caller can see that.
3. **`deny` never runs, anywhere.** Including client tools (today they bypass it).
4. **The pause is visible on every path.** Batch responses carry the stop reason and, when
   paused, the pending interaction identity. Nobody has to query spans to learn their run
   stopped.
5. **No decision comes from transport metadata.** Deleting a session id changes nothing
   about permissions.

One consequence worth stating up front, because it reframes the original reproduction: the
`uc9-digest` run will still pause at `SEND_MESSAGE` under default config, even after the
fix. Resolved gateway tools carry a `read_only` hint from the Composio catalog, and the
per-tool ladder defaults mutating tools to `ask`
(`sdks/python/agenta/sdk/agents/tools/models.py:273-292`; confirmed populated at
`sdks/python/agenta/sdk/agents/platform/gateway.py:199`). That default is deliberate:
capability-config's design says reads auto-run, writes prompt.

What changes is that the pause becomes *authored, visible, and answerable*. The author who
wants the digest posted headless sets `permission: allow` on `SEND_MESSAGE` (one select in
the tool editor), and the run completes end to end. The `auto` policy governs tools with no
disposition at all, and it actually works again.

## Options considered

**Option A: the one-line fix.** Consult `basePolicy` before parking
(`responder.ts:201-206`). Restores `auto` for everything, including tools that resolved to
`ask`: the playground prompt disappears entirely, and an author's explicit "ask me first"
is silently auto-approved. Rejected.

**Option B: disposition-aware responder only.** The responder looks up the gated tool's
`permission` from the run request's tool specs (`allow` allows, `deny` denies, `ask` parks,
unset falls to the policy) and `hasHumanSurface` dies. This fixes resolved tools but leaves
one hole: authors can write raw `ask` rules for Claude *builtins* (`Bash`, `Edit`...) via
`harness.permissions`, and those exist only inside the rendered settings file. The responder
would see a builtin gate as "unset" and auto-approve it under a default of `allow`. An
explicit authored "ask" being silently approved is the worst failure mode on the table.
Rejected as an end state.

**Option B+C: B plus Option C.** Same hole as B. Acceptable only as a stepping
stone if we accept a documented temporary gap for builtin ask-rules.

**Option D: one resolved permission plan (recommended).** The SDK computes every
disposition once and ships it on the run request; the runner only enforces. This closes the
builtin hole (authored builtin rules travel in structured form), unifies the relay and the
responder on one decision function, and removes both duplicate computations and the
vocabulary split. The independent Codex review concurred, and specifically recommended
doing this in one shot rather than staging through B: there are no compatibility
constraints, B leaves duplicate policy logic alive, and the extra cost over B is mostly
wire-shape and test churn.

**Recommendation: D, in one shot, plus the visibility work (4) and the correctness debt
that lives in the same code.** If implementation reveals the wire change is heavier than
expected, fall back to landing B+C first with the builtin-ask gap explicitly documented,
then finish D. That decision can be made mid-implementation without wasted work, because
B's responder change is a subset of D's.

## The target design

### One wire contract for permissions

The run request gains one coherent block, replacing the stringly `permissionPolicy`:

```
permissions: {
  default: "allow" | "ask" | "deny",   // was permission_policy auto|deny; auto -> allow
  rules?: [                            // authored harness-builtin rules, structured
    { pattern: "Bash(rm:*)", permission: "ask" },
    ...
  ]
}
```

Per-tool dispositions keep riding where they already are (`customTools[].permission` and
`mcpServers[].permission`), but the SDK writes the **resolved** value (the output of
`effective_permission()`, so `read_only`/`needs_approval` defaults are already applied) and
the runner never re-derives it. Semantic roles stay clean: `permissions` is policy, owned by
the author, resolved by the SDK; `sessionId` goes back to being pure correlation.

Vocabulary: `allow | ask | deny` everywhere. A global default of `ask` becomes expressible
(approval-by-default agents). The authored config path moves from
`runner.interactions.headless` into the permission family (proposal: `permissions.default`
next to the existing `harness.permissions` and tool permissions; final name settled at
implementation, but it must contain the word "permission" and live with the policy fields).

### One decision function

```
resolvePermission(gate, plan):
  disposition = plan.toolSpec(gate)?.permission     // resolved tools, MCP servers
             ?? plan.matchRule(gate)                 // structured builtin rules
             ?? plan.default
  if disposition == "deny":  return deny
  if disposition == "allow": return allow            // reply "once", run continues in place
  // disposition == "ask":
  stored = storedDecision(gate)                      // {approved} envelopes from the replay
  if stored: return stored (consumed once)
  return pendingApproval                             // park: no reply, end turn "paused"
```

Order matters, twice over. The disposition is resolved *before* stored decisions are
consulted, so a stale approval can never override a config that has since changed to `deny`
(today stored decisions are checked first). And a stored decision is consumed on first
match, so one approval authorizes one execution ("once" semantics, code-review M1).

The same function backs both gates: the ACP responder (harness-gated tools) and the relay
(runner-executed tools). Deciding and executing stay separate jobs (Mahmoud's review point,
2026-07-03): the decision runs *before* execution, in the shared function, and the relay
itself carries no permission logic; it executes calls that were already permitted. The
relay's `TODO(S5)` collapse disappears; the relay can already park for client tools, and an
`ask` on a relay tool parks the same way. Client tools stop being a special case: they
resolve through the same function and simply default to `allow` (their fulfillment *is* the
browser interaction), so `deny` and `ask` work on them with no extra code. `hasHumanSurface`
is deleted. `PolicyResponder` is deleted. An `ask` park on a headless run is correct
behavior: the turn ends `paused`, visibly, with an interaction row for the future
durable-resume flow.

### Events mean actions

`interaction_request(user_approval)` is emitted only when the decision is `pendingApproval`
(today it fires before the decision, so auto-approved gates would emit false prompts). What
ran is already visible through `tool_call`/`tool_result` events.

### The pause is visible on batch

`_agent_batch` returns `stop_reason` alongside the messages and, when paused, the pending
interaction reference (id/token). Exact response shape to be settled against the streaming
work in `../builder-agent-reliability/streaming-invoke/` (which owns the batch-vs-stream
story); the requirement from this side is only: a paused run must be distinguishable and
reference its pending approval.

## Execution phases

Each phase lands green on its own. Sizes are rough.

**Phase 1: the decision core (runner, ~the heart of the fix).**
`resolvePermission` as one exported function; responder and relay call it; delete
`hasHumanSurface` and `PolicyResponder`; emit approval events only on park; consume stored
decisions once. Rewrite the responder decision tests as a generated truth table
(disposition × stored-decision × default), replacing the tests that pin the bug
(`responder.test.ts:227-237` and the park-by-default cases; list in code-review.md §tests).

**Phase 2: the wire and the SDK (Python).**
`permissions.{default, rules}` on the run request (typed enum, mirrored in `wire.py`, the Python copy of the runner's wire types;
golden fixtures updated); SDK resolves per-tool dispositions at request build time
(`effective_permission()` output onto the specs); structured builtin rules derived from the
same authored `harness.permissions` lists that feed the settings renderer, so the two
cannot disagree; authored config path renamed into the permission family; Claude settings
rendering unchanged in behavior (it already renders resolved allow/deny; verify `ask`/unset
still leaves the gate raised).

**Phase 3: service and frontend.**
Batch surfaces `stop_reason` + pending interaction reference; fix the stream-setup cleanup
leak (code-review M6). Frontend: the config form writes the renamed field (the "Permission
policy" select becomes the permission default, vocabulary `allow | ask | deny`); no changes
to the approval UI or resume machinery (they keep working for `ask` tools; verified by the
frontend research: nothing in the UI depends on parking for non-ask tools).

**Phase 4: correctness debt in the same code (from code-review.md).**
H1 (reply failure parks or fails loud; resolve interaction only after a successful reply),
H2 (only `{approved}` envelopes become decisions; client-tool replay scoped by interaction
token), M2+M3+M7 as one item, now diagnosed via PR #5054 (see the live-warning section of
how-approvals-work.md): the observed loop = a constant stream `messageId` plus a
level-triggered resume predicate (M7, frontend half) compounded by tool-*name* drift across
ACP frames breaking the decision key (M2's observed form). The durable fix here is the
direct replay of the approved call, which removes the reassembled-key fragility class
(name drift, argument drift) outright; approval responses must correlate by `toolCallId`
and drop loudly otherwise (M3), M4
(client tools resolve through the same ladder, defaulting to `allow`), M5 (latch the stop
reason before the relay drain), L1 (no-id gates park instead of silently hanging), H3
(verify the daemon's permission-id scheme; if per-session counters, namespace interaction
tokens with the turn), L2 (reserve the `agenta-tools` MCP server name in the settings
renderer).

**Phase 5: organization cleanup (from code-organization-review.md).**
Extract the park controller from `sandbox_agent.ts` into the `engines/sandbox_agent/`
family; rename `park` → `pendingApproval` internally (wire `stopReason: "paused"` stays);
`permissions.ts` → `acp-interactions.ts`; the four-site permissions map as a header doc;
fix the stale `services/agent/` pointers and pin the `agenta-tools` coupling with a shared
fixture test.

**Phase 6: proof.**
Live matrix on the dev stack (Claude harness, a model with credit):
- headless batch + streaming: unset tools under default `allow` run through; the run
  finishes; no approval events.
- headless with an `ask` tool: run ends `paused`, batch response says so, interaction row
  exists.
- playground with an `ask` tool: prompt renders, approve resumes and **completes without
  looping**. This case is currently broken live (Mahmoud, 2026-07-03: Approve loops, the
  run re-parks and re-prompts repeatedly), which is the observed form of code-review M2/M3.
  Reproduce first, fix in phase 4, and pin the pass as the replay test. Deny resumes and
  continues without the tool (the two old approval-UI bugs stay fixed: F-024, the reject
  that clobbered the prompt, and F-036, the deny that left the run hanging).
- playground with everything `allow`: no prompt, tools visibly run (the owner's "auto means
  auto" check).
- Pi: unchanged (never gates; relay enforces deny/allow; relay `ask` now parks; verify the
  client-tool park machinery carries it, else stage relay-ask into its own slice).
- uc9-digest end-to-end: set `SEND_MESSAGE: allow`, headless run completes all four tools
  and posts; with default config, run pauses visibly at `SEND_MESSAGE`.
Then pin one park→approve→resume pair as a replay test (`agent-replay-test` skill) and a
producer-side SDK test asserting what `/invoke` actually sends in `sessionId` (the missing
test that let the proxy rot).

## Behavior deltas (before → after)

| Case | Today | After |
| --- | --- | --- |
| Headless, unset tool, policy auto | Parks silently; batch hides it | Runs in place |
| Headless, `ask` tool | Parks silently | Parks visibly (`stop_reason`, interaction ref) |
| Playground, unset tool, policy auto | Prompts (park) | Runs, tool activity visible, no prompt |
| Playground, `ask` tool | Prompts | Prompts (unchanged) |
| Playground, `allow` tool | No prompt (settings rule) | No prompt (unchanged) |
| `deny` on a client tool | Ignored | Refused |
| Stored approval vs changed-to-deny config | Approval wins | Deny wins |
| One approval, model repeats identical call | Every repeat auto-runs | One approval, one run |
| Claude builtin with authored `ask` rule | Parks | Parks (rule travels on the wire) |

## Risks and open questions

- **Relay-ask parking on Pi.** The relay can park client tools today, but `ask` parks for
  ordinary relay tools need the same turn-boundary treatment (the old S5.2). If it turns
  out heavy, ship relay-ask as its own slice and keep the collapse only for Pi, documented,
  while Claude paths use the full design.
- **Rule matching for builtins.** The structured `rules` need a matcher compatible with
  Claude's rule syntax (`Bash(npm run:*)`). Scope it to exactly what the settings renderer
  accepts today; anything fancier stays authored-settings-only and documented as such.
- **Reassembled-key fragility on resume (code-review M2/M7, diagnosed).** The live
  approve-loop is explained: constant `messageId` + level-triggered resume predicate on the
  frontend, tool-name drift across ACP frames on the backend. Fix direction settled: the
  runner replays the approved call directly, removing the whole matching class. Two pieces
  of PR #5054 are worth absorbing regardless (unique per-turn message id; the
  "already resumed" edge-trigger guard); two pieces should be superseded by this plan, not
  inherited (the `resolvedName` stamping that patches the name drift, and especially the
  `nonConvergingToolNames` loop-breaker that silently auto-DENIES a gate after three
  non-converging approvals: it is keyed by bare tool name globally, can false-positive on a
  busy tool, reintroduces the F-024 deny-clobber deliberately, and gives the user no signal
  that their approved tool was blocked).
- **Batch response shape.** Owned jointly with the streaming-invoke workspace; this plan
  only requires that paused be distinguishable.
- **Vocabulary migration.** `auto` → `allow` and the authored-path rename touch the FE
  form, SDK parsing, wire, fixtures, and docs in one PR. POC status makes this safe, but it
  is the churny part; the golden wire contract test is the safety net.
