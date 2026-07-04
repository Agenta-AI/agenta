# Plan

The build is small because it reuses the decision module, the relay loop, and the pause path
whole. The risk is not the code; it is whether Pi re-issues a blocked builtin after approval.
So Phase 0 buys down that risk before anything else.

## Phase 0: spike the re-issue behavior (do this first)

Goal: watch Pi's behavior after a `tool_call` hook blocks a builtin, then resume, with the
real relay pause in the loop.

Steps:

- Write a throwaway extension whose `tool_call` hook blocks `bash` once with `{ block: true,
  reason: "..." }`, then allows it. Load it into local Pi and run a prompt that calls `bash`.
- Confirm the model calls `bash` again after the block, and that the second call carries the
  same arguments (so stored-decision matching would hit).
- Try two reason texts: a neutral one and one that explicitly says to retry after approval.
  Record which produces a reliable re-issue.
- Then repeat the spike through the real runner pause and teardown, not just a throwaway local
  block, and inspect the actual resumed transcript. Pi core turns `{ block: true }` into an
  error tool result, so re-issue is a pure model-behavior outcome; confirm it on the real
  resume path, not in isolation.

Pass condition: run the spike 5 times through the real runner pause and teardown. Phase 0
PASSES only if, across all 5 of 5 runs, the approved builtin executes exactly once after
resume, never before approval, with the same canonical args each time (so the stored decision
matches). Record the resumed transcript from each run as evidence. Any run that misses the bar,
a double execution, a pre-approval execution, an args mismatch, or no re-issue at all, fails
the phase. On any failure, stop and take the design back to the owner rather than patching
around it; the fallback (holding the turn open on the hook side instead of blocking) is a
materially different design and needs sign-off before it is built.

## Phase 1: the relay permission record and the runner decision

- Extend the relay records into a real discriminated union keyed by `kind` (`"execute"` vs
  `"permission"`), not a shared type with optional fields (`services/runner/src/tools/relay.ts`
  types at lines 46-55). The permission response carries `kind: "permission"`, `ok`, `verdict:
  "allow" | "deny" | "pendingApproval"`, and `reason?`. Parse it through a dedicated validator so the existing
  `relayToolCall` path can never mis-read a permission response as a tool result.
- In `startToolRelay`'s `handle` (relay.ts:312), branch on `kind`. For `"permission"`: build
  the `GateDescriptor` (`executor: "harness"`, `toolName`, `readOnlyHint` from the new builtin
  table, `args`), call `decide`, and write a response on **every** branch, including pending.
  On pending, call `onPendingApproval` first, then write `{ verdict: "pendingApproval", reason
  }` verbatim, the same as `decide()` returned. This handler never writes a block; the
  verdict-to-block mapping lives in the extension hook at the Pi boundary.
- Add the builtin identity table next to `decide()` in
  `services/runner/src/permission-plan.ts`: canonical rule name, read-only bit, and the
  match projection (bash -> `command` only; every other builtin -> full canonical args).
  No new `GateExecutor` value; builtins use `"harness"`.
- Change `RelayPermissions.onPendingApproval` (relay.ts:69) to return whether it emitted the
  approval event (a boolean or `{ emitted }`), so the handler writes the plain
  waiting-for-approval reason when it emitted and the another-approval-pending reason when the
  latch was already held.
- Unit tests: allow, deny, and pending each produce the right response record; a pending
  record both calls `onPendingApproval` and writes the `pendingApproval` verdict verbatim
  (never a block, the handler does not map verdicts); a latch-held pending writes the
  another-approval reason; an all-`allow` policy produces allow for `bash`; a read builtin
  (`grep`) allows under `allow_reads` while a write builtin (`write`) asks; a `bash(git:*)`
  prefix rule matches on the real command argument.

## Phase 2: extension interception and grant enforcement

- Add `hasBuiltinGating` to the extension's inertness guard (agenta.ts:165) so a gating-only
  run (no custom tools, no tracing, no usage) does not early-return before registering the hook.
- Add the `tool_call` hook to `services/runner/src/extensions/agenta.ts`, registered only
  when `AGENTA_AGENT_BUILTIN_GATING` is set. Narrow with `isToolCallEventType`. For a builtin,
  the hook does policy only, no grant check: it writes a permission record through a new
  `relayPermissionCheck(dir, toolName, toolCallId, args)` helper in `dispatch.ts` (sibling of
  `relayToolCall`, reusing `sanitizeRelayId`, `RELAY_POLL_MS`, `RELAY_TIMEOUT_MS`, and a
  dedicated permission-response validator). Return `{ block: true, reason }` on block, nothing
  on allow. Fail closed on a bad or missing response.
- Grant enforcement: shape the active tool set at `before_agent_start` (not extension init,
  where Pi stubs the action methods). Read `getActiveTools()` and `getAllTools()` and replace
  only the builtin portion with the granted subset, so user and local extension tools pass
  through untouched. A non-granted builtin is then absent from the active set, so its
  `tool_call` never fires; there is no second grant check anywhere else.
- Prompt-ordering guard: `before_agent_start` handlers chain, and a later handler can hand back
  a system prompt built from a stale copy that still lists a builtin we just removed. Assert,
  in a test, that a removed builtin's name is absent from the *final* system prompt of the
  turn (after every registered handler has run), not only from the value our own handler
  returns. Re-enabling a builtin from a second extension's `setActiveTools` call is out of
  scope for this slice (every run installs exactly one extension, ours); noted for the day a
  user-supplied extension ships alongside ours.
- Validate `AGENTA_AGENT_BUILTIN_GRANTS`: de-dupe, keep only the seven known builtin names, and
  drop-and-log unknowns.
- Rebuild the bundle (`scripts/build-extension.mjs`) so the local and Daytona installs carry
  the hook.
- Tests: a non-granted builtin is absent from Pi's active tool set after `before_agent_start`,
  and therefore its `tool_call` never fires; a granted builtin round-trips a permission record;
  the hook is absent when the gating env is unset (the inert path); a gating-only run still
  registers the hook (the inertness-guard fix); a removed builtin's name is absent from the
  final system prompt of the turn (the prompt-ordering guard above).

## Phase 3: env plumbing and always-on relay when gating is active

- Add a first-class `builtinGatingActive` flag and a normalized `builtinGrants` list to
  `RunPlan` (run-plan.ts), computed once. Do not recompute the predicate separately in env
  building, workspace prep, and relay startup.
- Compute the predicate from `permissionsFromRequest(request)` (permission-plan.ts:58), not
  raw `request.permissions`, so the operator kill switch and the fail-to-ask behavior are
  honored. Gating is active when the run is Pi and either the resolved policy could produce
  anything but `allow` for a builtin, or the requested grant set differs from Pi's default
  active builtins (`read`, `bash`, `edit`, `write`). Distinguish `tools: undefined` from
  `tools: []`. Default to on when unsure.
- `buildPiExtensionEnv` (pi-assets.ts:33) emits `AGENTA_AGENT_BUILTIN_GATING`,
  `AGENTA_AGENT_BUILTIN_GRANTS`, and `AGENTA_AGENT_TOOLS_RELAY_DIR` from the plan fields.
- `useToolRelay` (run-plan.ts:329) becomes `toolSpecs.length > 0 || builtinGatingActive`, and
  the relay-dir creation in `workspace.ts` follows.
- Tests: `tools: ["read","write"]` under blanket `allow` turns gating on (must remove `bash`
  and `edit`); `tools` with `grep`/`find`/`ls` turns it on (must enable them); an all-`allow`
  run with the default builtins granted leaves gating off and the fast path unchanged; the
  kill switch (`SANDBOX_AGENT_DENY_PERMISSIONS=true`) forces gating on; gating-active flags set
  the three env vars and turn `useToolRelay` on with zero custom tools.

## Phase 4: contract, parity, and pin tests

- The relay record types are runtime files, not part of the `/run` golden wire, so no golden
  changes. Add a small fixture test for the permission record round-trip.
- Parity test: `bash: ask` produces a pending on Pi that mirrors the pending a custom `ask`
  tool produces (same event shape, same `availableReplies`).
- Pin test (agent-replay style, per the `agent-replay-test` skill): capture one real gated
  builtin `/run` and replay it without a live LLM, so the wiring cannot silently regress the
  way the grant list did in `0e71bd0f7a`.
- Re-enable the grant list assertion: a run whose `tools` omits `bash` cannot call `bash`.
- Case normalization: add the runner-side table that maps a Pi builtin name to both its
  canonical rule name and its read-only bit (the same table `readOnlyHint` comes from), and
  route the permission-record handler's `toolName` through it before calling `decide`. Test
  that an authored `Bash(npm:*)` rule matches a Pi `bash` call, so a `Bash(...)` rule does not
  silently miss a lowercase Pi call.
- Version skew guard: add a `protocol: 1` field to the permission record. Test that the
  runner's permission-record handler fails closed (verdict `deny`, logged) on a missing or
  unknown protocol version, and that the extension hook treats a malformed or
  version-mismatched response the same way. Add a build/CI guard, reusing the existing
  `build:extension` step, that fails when `dist/extensions/agenta.js` is stale relative to
  `src/extensions` (source changed, bundle not rebuilt), so a stale-bundle regression like the
  one that silently dropped custom tools cannot recur for gating.

## Phase 5: live validation across the matrix

Run the `agent-workflows-qa` matrix for the gated builtin cases:

- Local Pi: `bash: ask` pauses in the playground, Approve runs the command, Deny refuses,
  the whole flow re-issues cleanly (the Phase 0 behavior, now end to end).
- Daytona Pi: the same, to confirm the sandbox relay host carries the permission record and
  the teardown race is benign.
- `allow_reads`: `grep`/`find`/`ls`/`read` run without a pause; `bash`/`edit`/`write` ask.
- Grant list: a run that enables only `read` and `grep` cannot `bash`.
- Regression: a Pi run with a blanket `allow` policy and all builtins granted shows no relay
  overhead and behaves exactly as today.

## Documentation to keep in sync (per the `keep-docs-in-sync` skill)

- The agent-workflows tools and protocol pages under
  `docs/design/agent-workflows/documentation/`.
- The interface inventory entry for the relay record and the `tools` field.
- The `BuiltinToolConfig` note in `sdks/python/agenta/sdk/agents/tools/models.py:87`: once
  builtins are enforceable, the "selection-time enforcement is the designed follow-up" comment
  should point here, and re-enabling a per-builtin permission becomes a scoped follow-up.
