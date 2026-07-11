# Pi approval parking: status

Source of truth for progress. Keep this current.

## Current state (2026-07-09)

- Phase: planned, not started. This workspace was created from the parkable-gates design
  (`../session-keepalive/followups/parkable-gates/`) after its Option C was proven by the
  live spike the same day; it ships in PR #5153 alongside that design.
- The plan is implementation-ready pending two gates: the slice-0 live daemon confidence run
  (open-questions.md #1) and a coordination check with the backend warm-session move
  (context.md, constraints).

## Decisions inherited (do not relitigate here)

- Mechanism: Option C, the ACP permission plane via `ctx.ui.confirm` plus the JSON envelope.
  Options and trade-offs live in the parkable-gates design; the evidence lives in its
  `spike-option-c/` folder. Option B (park the relay wait) is the recorded fallback if
  slice 0 fails.
- Judged by the call-sequence invariant; warm parking is the only byte-exact tier
  (kill-and-resume experiments, `../harness-session-resume/experiments/report.md`).
- Approval TTL default 5 minutes; resume validation checks decision + history + mount expiry
  (slice-2 realities, parkable-gates design "How this composes").

## Provenance

- 2026-07-09: workspace created (context, research with current code anchors, plan with four
  slices plus the slice-0 gate, open questions, this file). Research verified against
  `services/runner/src` post #5178/#5183. Two implementation-relevant findings made during
  planning, folded into plan.md: the reply-option mismatch (`decisionToReply` falls back to
  `once`/`reject`; the Pi dialog offers `yes`/`no` and needs kind-based selection), and the
  double-gate (a dialog-allowed custom tool still hits the relay watcher's
  `permissions.decide`; bridged by writing the consumed allow into the turn's stored
  decisions). The first finding was OVERTURNED by the plan review the same day (see below);
  the second was confirmed and deepened.

## Plan review round (2026-07-09, Codex xhigh)

Architecture approved; 3 blockers and 4 must-fixes folded into plan.md, research.md, and
open-questions.md the same day. All findings were code-verified by the reviewer:

- B1: the planned reply-option mapping was wrong and is DELETED. The sandbox-agent daemon's
  `respondPermission` maps `{once, always, reject}` to the dialog option by kind internally
  (`permissionReplyToResponse`, chunk-TVCDKGSM.js:2811; `PermissionReply`, index.d.ts:2976);
  implementing the plan's mapping would have turned approvals into denials (a literal "yes"
  falls to the mapper's reject branch). The spike saw raw ids only because it drove `pi-acp`
  directly, below the daemon. Slice 0 now doubles as the live check on this mechanism.
- B2: slice 1 must normalize `req.toolCall.toolCallId` to the envelope's real id at the top
  of `handleRequest`, or the warm resume never fires (`approvalDecisionForToolCall`,
  `session-pool.ts:231`, matched at `server.ts:624`) and pause suppression mis-keys,
  clobbering the FE approval card (the Vercel egress keys on payload toolCallId,
  `stream.py:620`). Stamping only the emitted payload is insufficient.
- B3: slice 3 must widen the `ParkedApproval.gateType` literal (`sandbox_agent.ts:368`) AND
  update the `server.ts:628` guard that hard-rejects non-Claude gate types; either alone
  fails (compile error / always cold).
- M1: the envelope carries identity only; permission metadata (`specPermission`,
  `readOnlyHint`) is recovered runner-side by spec lookup (plus `piBuiltinIdentity`),
  restoring relay parity; otherwise author-allow tools newly pause and read-only builtins
  get asked.
- M2: the double-gate bridge premise holds (shared `ConversationDecisions`,
  `sandbox_agent.ts:1218/1225/1268`) but the object is write-closed; the plan now specifies
  a FIFO append API, consume-1-append-1 accounting on the cold dialog path, the key-parity
  invariant, and a warm-resume seeding verification (`extractApprovalDecisions`) or an
  explicit append before `sandbox_agent.ts:1389`.
- M3: the dialog gate is scoped to non-client executable tools; client tools
  (`public-spec.ts:43` registers them too) keep their browser-fulfilled pause path
  (`dispatch.ts:239`, `relay.ts:214`).
- M4: a malformed envelope under the matching title replies reject (fail closed); the
  earlier fall-through default was an unapproved-execution hole under a default-allow plan.
  open-questions #6 corrected accordingly.
- Doc corrections folded: flag plumbing lives in `buildPiExtensionEnv`
  (`pi-assets.ts:67-78`), name pair `AGENTA_RUNNER_PI_DIALOG_GATE` ->
  `AGENTA_AGENT_PI_DIALOG_GATE`; multi-gate documents the harness-agnostic safe degrade
  (`approvalToPark` refuses count > 1, `server.ts:407`) instead of asserting count == 1;
  builtin-only runs can skip the relay (`useToolRelay`, `run-plan.ts:447`); slice 1's
  deliverable reframed as dark (unit-test-only until slice 2 turns the extension on).
- Retired in open-questions.md: the reply-plumbing concern (resolved opposite to the draft),
  concurrency (safe degrade documented), warm-deny mechanics (sound after B2; the UX product
  call stays open as #5).

## Implementation (2026-07-09/10, lane feat/pi-approval-parking, PR #5185)

Slices 0-3 implemented; slice 4 (live QA) runs as a separate stage.

- Slice 0 PASSED both criteria live through the sandbox-agent daemon on the dev box: the
  envelope arrived byte-exact at a runner-side `onPermissionRequest` handler (hostile probe
  string included), and a plain `respondPermission(id, "once")` resolved the held dialog to
  allow so the original `park_probe` ran with its original token, immediately and after a
  180-second hold with no reaper. The daemon exposed `availableReplies: ["once","reject"]`,
  confirming B1 (no reply mapping); the synthetic `pi-ui-<uuid>` id on the ACP request
  confirmed B2 (normalization required).
- Slices 1-3 landed per plan.md, then two review rounds (an internal Opus review, a Codex
  xhigh review, CodeRabbit) tightened the fail-closed identities: unknown builtin AND
  unresolved custom-tool names reject; envelope detection is scoped to Pi runs structurally.
- Scope change (Mahmoud, 2026-07-10): the dialog gate shipped WITHOUT a feature flag as the
  only Pi permission path, and the relay permission plane was deleted (extension
  `relayPermissionCheck` poll, `handlePermissionRelayRequest`, the `kind: "permission"`
  record protocol, `RelayPermissions` enforcement, the planned double-gate FIFO bridge).
  The relay carries tool execution and results only; a builtin-only run starts no relay.
  `ParkedApproval.gateType` for the Pi plane is `"pi-acp-permission"` (symmetric with
  `"claude-acp-permission"`).

## Next steps

1. Slice 4: the live warm/cold matrix on the dev box (separate QA stage).
2. JP coordination: the park record moves with the pool wherever the backend warm-session
   work lands (checked 2026-07-09: no active migration in flight).
