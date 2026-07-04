# Status

## State

Design awaiting Mahmoud's review. No code has shipped. This workspace is the design and the
plan. The build starts after the design is approved and after the Phase 0 spike confirms Pi
re-issues a blocked builtin.

## Decision log

**Option B chosen: intercept in our extension, decide in the runner.** The extension's
`tool_call` hook reports each builtin call, and the runner decides it through the existing
relay permission machinery and the one shared `decide()`. This makes `bash: ask` expressible
on Pi and re-activates the builtin grant list, with the real tool name and real arguments on
the runner side.

**Option A rejected: `ctx.ui.confirm` over ACP.** In that shape the runner-side gate would
see only a synthetic tool call. The real arguments stay in the sandbox. So argument-prefix
rules (`bash(git:*)`) and read-only classification would split across two sides, and the
decision module would no longer be the single source of truth. That breaks the doctrine this
design exists to uphold.

**Option C rejected: fork Pi.** The `tool_call` hook already exists and already can block. A
fork buys nothing and costs re-patching every Pi release in the runner image and the Daytona
snapshot forever.

**Executor reuses `"harness"` (settled, was open).** The first draft leaned toward a new
`GateExecutor` value `"builtin"`. The Codex review argued that `executor` names the executing
*component*, and Pi runs its own builtins, so the honest value is `"harness"`. The
pending-to-block mapping and the read-only lookup are post-decision handling that lives in the
builtin permission-record handler, not in the descriptor. Accepted. No new enum value; add a
named `toolClass`/`gateSource` dimension later only if resume anchoring ever needs it.

**Grant list via `setActiveTools`, at `before_agent_start` (leaning yes, open).** The grant
gap maps most cleanly to Pi's active-tool allowlist, so the model never sees a non-granted
builtin. The Codex review corrected two things: `setActiveTools` cannot run at extension init
(Pi stubs the action methods there), so the edit runs at `before_agent_start`; and the edit
must preserve non-builtin active tools (`getActiveTools()` + `getAllTools()`, replace only the
builtin slice) so it never drops a user or local extension tool. Block-in-hook stays the
fallback. Phase 2 confirms after a live check.

**Discriminator over a second file suffix (settled).** One `kind` field keeps a single relay
poll loop and one host abstraction serving both record types. Codex agreed, with the condition
that the types be a real discriminated union (not a shared type with optional fields) and that
the permission response be parsed through its own validator so `relayToolCall` never reads it
as a tool result. Both folded into design.md.

## Open risks

1. **Re-issue after block (top risk).** Whether Pi re-issues a builtin call after the hook
   blocks it and the turn resumes is unverified. Phase 0 spikes it before any build. Fallback
   is a retry-nudge reason, or, if Pi will not re-issue at all, a return to you before
   building.
2. **Relay polling timeout.** The runner must always write a response for a permission record,
   including on pending, or the hook hangs 60s. Pinned by a Phase 1 test.
3. **Concurrent pending builtins and the single-pending latch.** The second pending builtin in
   one message must still get a block response so its hook does not hang. Handled and tested in
   Phase 1.
4. **Gating-active predicate.** Getting it wrong the safe way (gating on when it could be off)
   only costs a relay round-trip per builtin. Getting it wrong the unsafe way (off when it
   should be on) would silently skip the gate, so the predicate defaults to on when unsure.

## Provenance

Design workspace created 2026-07-04. Research read against the `gitbutler/workspace` branch.
Codex review folded in below.

## Codex review

**Round 1 (2026-07-04, gpt-5.5 at xhigh, read-only).** Codex read the workspace and Pi's own
source. Every finding was accepted and folded into design.md and plan.md. Nothing was rejected.

Blockers folded in:

1. `setActiveTools` cannot run at extension init (Pi stubs the action methods there). Moved to
   `before_agent_start`, with a check that it affects the current turn's system prompt.
2. The gating-active predicate was wrong. Pi's default active builtins are `read`, `bash`,
   `edit`, `write`, not all seven, so the requested grant set alone can require gating even
   under blanket `allow`. Predicate rewritten; `tools: undefined` now distinct from `tools: []`.
3. Compute the predicate from `permissionsFromRequest(request)`, not raw `request.permissions`,
   so the `SANDBOX_AGENT_DENY_PERMISSIONS` kill switch and fail-to-ask are honored.
4. The re-issue mitigation was too soft. Pi turns `{ block: true }` into an error tool result,
   so re-issue is pure model behavior. Phase 0 now spikes it through the real runner pause and
   teardown and inspects the resumed transcript; if Pi will not re-issue, the design stops.
5. The concurrent-pending handling needs `onPendingApproval` to return whether it emitted;
   today it returns `void`. Contract change recorded in design.md and plan.md.
6. The extension's inertness guard (agenta.ts:165) early-returns a gating-only run. Added
   `hasBuiltinGating` to the guard.

Improvements folded in: real discriminated-union record types with a dedicated permission
validator so `relayToolCall` never mis-parses a permission response; `executor: "harness"`
instead of a new `"builtin"` value; preserve non-builtin active tools when editing the active
set; first-class `builtinGatingActive` + `builtinGrants` on `RunPlan`; lowercase Pi builtin
rule names versus Claude-style `Bash(...)`.

Nits folded in: response field renamed `decision` -> `effect` to avoid colliding with the
permission module's `allow | deny`; validate `AGENTA_AGENT_BUILTIN_GRANTS` (de-dupe, known
seven, drop-and-log unknowns). Codex also confirmed the pending-and-block double effect is
sound because `toolRelay.stop()` drains inflight handlers before teardown.
