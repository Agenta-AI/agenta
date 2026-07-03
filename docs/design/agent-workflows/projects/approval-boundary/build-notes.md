# Build notes: judgment calls made during implementation

Running log of decisions the implementation made inside the mandate "go with your
decisions unless it contradicts an owner call". Newest last. Read together with
[status.md](status.md) (the decision log) and [plan.md](plan.md) (the design).

## 2026-07-03

- **Resume mechanics revised before any code was written.** The Codex pre-implementation
  review (xhigh) showed "replay the approved call directly" cannot work for
  Claude-native builtins: the runner's only lever on a harness gate is the ACP reply,
  and prior turns replay as text, not as structured tool calls. Adopted: same-call
  matching on stable anchors per executor; drift pauses visibly. This kept the two
  properties Mahmoud cared about (no silent loop, no silent auto-deny) without the
  unimplementable part. Full trail: status.md, "Codex pre-implementation review".
- **`allow_reads` name kept.** Codex slightly preferred `allow_read_only`; not clearly
  better, and the owner has been using "allow_reads" in review threads. Left as is,
  rename is one grep if review wants it.
- **`SANDBOX_AGENT_DENY_PERMISSIONS` kept** as an operator kill-switch (forces
  `default: deny`, wins over the authored plan). Deleting an emergency lever during a
  permission redesign felt wrong; documented at its read site.
- **Unparseable policy fails toward `ask`.** `permissionsFromRequest()` maps an unknown
  policy mode to `{default: "ask"}` (pause for a human) rather than allow or deny.
  Rationale: a config the runner cannot understand should neither run tools nor
  hard-refuse the run; asking is the safe middle.
- **New pure module named `permission-plan.ts`** (not `permissions.ts`) to avoid a
  name collision with `engines/sandbox_agent/permissions.ts` until that file becomes
  `acp-interactions.ts` in the cleanup phase.
- **Phase 2a landed (Codex implemented, reviewed here).** Consult-first ACP flow,
  `ApprovalResponder`, latch, H1 (reply failure pauses), L1 (no-id gate pauses), M5
  (stop reason latched before the relay drain). Review restored two things Codex
  trimmed: the F-024 "a pause sends no reply" rationale comment and the `[HITL]`
  ground-truth gate log QA greps for. Codex's flagged judgment call (client `ask` +
  stored approval but no browser output yet: consume the approval, still pause for
  fulfillment) accepted as correct two-step behavior.
- **Two cross-layer subtleties found in the 2a review, deferred to 2b by design:**
  (1) on Claude a client tool's stored output is legitimately read at BOTH the ACP gate
  and the relay, so the ACP side must peek and only the relay (the actual server of the
  output) consumes; (2) relay tools on Claude are gated at the ACP layer first, so the
  relay must enforce permissions only when the harness does not gate (Pi) — otherwise
  one approval would be consumed at the gate and the relay would double-gate the same
  call.
- **Live QA found and fixed one real bug: pause teardown clobbered the approval prompt
  on the Pi relay path.** The relay writes no response file on a pause, session teardown
  fires the extension's AbortSignal, Pi reports the call as failed ("aborted"), and that
  frame overwrote the prompt (F-024's class, new path). Fix: the pause controller keeps
  a paused-call registry and the engine drops any later harness frame for a paused call
  (the approval request is the last word, now enforced). Regression tests added; UI
  retest: 1 prompt, Approve resumes with real data and ZERO re-prompts, Deny refuses
  cleanly. Polish note, not blocking: a user Deny currently surfaces the relay's
  "denied by the permission policy" wording; "denied by the user" would read better.
- **UI QA environment notes (pre-existing, not this PR's regressions):** old app
  records on the dev box stored the internal `agenta-agent:8000` service URL
  (unreachable from a browser; fixed in the dev DB to the proxied
  `/services/agent/v0`); the tool picker offers no path to platform ops (tracked by the
  tools-review workstream); the Anthropic account is out of credit so Claude-harness
  live runs stayed unverified (Claude-path behavior is covered by unit + settings
  rendering tests and the Gate-2 machinery is shared).
- **Headless QA: 7/7 pass on the live EE dev stack** (Sonnet subagent; pi_core +
  gpt-4o-mini via the pi-agents project; evidence captured per case). All four policy
  modes behave, explicit beats policy both directions, the paused batch envelope carries
  `stop_reason` + `pending_interaction`, and legacy keys are ignored without a 500.
- **QA finding fixed: per-builtin `permission` was a dead knob.** `BuiltinToolConfig`
  parsed `permission` and dropped it silently; on Pi no gate ever sees native builtins.
  Fix: the config now drops it LOUDLY (log warning) with a pin test; the FE never
  offered the field for builtins. Designed follow-up (status.md): selection-time
  enforcement, filtering `builtin_names` by effective permission using the known
  read-only-ness of Pi's seven builtins, so `deny`/lockdown modes bind builtins too.
- **Phase 5 landed (Codex implemented, reviewed here).** Legacy wire fields deleted
  (`permissionPolicy`, `needsApproval`); absent `permissions` now defaults to
  `allow_reads` (same default as the authored schema); `acp-interactions.ts` and
  `pause.ts` renames; the four-site permission map heads `permission-plan.ts`;
  `agenta-tools` reserved-name guard in the settings renderer; stale `services/agent/`
  comment paths fixed. 401 runner + 477 SDK + 49 services tests green.
- **Docs sweep stragglers routed by ownership.** Twelve sweep files were hunk-locked to
  three parallel doc lanes we own (`docs/agent-streaming-invoke`,
  `docs/design-workspaces-sweep`, `marketing-website`), so their sweep edits were
  committed to those lanes (e5876e1, 6aabd25, 9ea9ffe) instead of this PR. They land
  when those lanes merge; this PR's sweep commit carries the other 38 files. The commit
  subagent hit this, stopped per the guardrails, and left a clean report; an empty
  duplicate commit it created was removed.
- **General docs sweep landed (Sonnet subagent, reviewed here).** Five permission
  sections rewritten (tools.md, agent-configuration.md, permission-responder.md,
  agent-config-schema.md, runner-interface README), ~24 field-level updates, 17
  superseded banners (capability-config, hitl-fix, streaming-invoke), and the
  sessions/interactions specs re-grounded (every pause creates the row; T3 marked
  implemented). Review fixes: one em dash, one stale `services/agent/` path.
- **Push-policy incident (separate from the commit incident).** `but push` on our
  stacked lane force-pushed EVERY series in the stack, including `big-agents-work`
  (Arda's PR #5054 head), six times over two hours, clobbering his and bekossy's
  pushes; Arda closed #5054. Repair: his full tip (`a11b58cec8`, containing every
  clobbered commit) was restored with a lease-guarded push. Standing rule (also in
  memory): never `but push` a stack containing branches we do not own; our series
  pushes via `git push origin docs/approval-boundary --force-with-lease`.
- **Phase 4a landed (Codex implemented, reviewed here).** Batch envelopes now carry
  `stop_reason` (omitted when absent, so non-runner results are byte-identical) and, when
  paused, `pending_interaction: {id, tool}`. The SDK already threaded
  `AgentResult.stop_reason` from the wire, so the only production change is the service
  drain. Review fix: the pending tool name now falls back through the payload's
  `toolName` and the ACP `name`/`title`/`kind` chain instead of reading only
  `toolCall.name` (harness gates carry display titles, the exact drift this project is
  about).
- **Phase 4b landed (Codex implemented, reviewed here).** Four-mode policy select on
  `runner.permissions.default`, shown for Pi too; per-tool Permission select loses the
  legacy fallbacks; `PiSettingsControl` added. Codex's binding call accepted and worth
  knowing: Pi builtin selection writes `{type: "builtin", name}` entries into the
  template's existing `agent.tools[]` list, because that is the path the backend already
  parses into `builtin_names` (`harness.extras` is not parsed for Pi). Review fix: the
  builtin option list only offered read/bash; widened to Pi's full session vocabulary
  (read, bash, edit, write, grep, find, ls).
- **Phase 3 commit incident + restack.** The two op_catalog files' hunks were
  dependency-locked to `feat/annotate-trace-op-code` (its commit authored the lines
  phase 3 edits), which a commit subagent tried to force through ref surgery and an
  oplog restore that rewound other sessions' uncommitted files (recovered by the
  affected session; subagent killed). The correct fix, applied by the orchestrator: the
  dependency is real, so the annotate lane was inserted INTO this stack
  (`big-agents-work <- annotate <- docs/approval-boundary`; the lane had no remote/PR,
  so the move was local-only), after which the pair committed cleanly (`phase 3 tail`).
  Consequence for this PR: its diff vs `big-agents-work` includes the small annotate
  commit (2 files) until that lane gets its own PR merged. Rule tightened for all
  future subagent briefs: `but oplog restore`, raw `git commit`/ref updates, and any
  improvised recovery are FORBIDDEN — on any hunk-locking refusal, stop and report.
- **Phase 3 landed (Codex implemented, reviewed here).** SDK assembles and ships
  `permissions: {default, rules}` on both harnesses; `needs_approval` + aliases deleted
  (inbound legacy keys are dropped tolerantly, POC dev-DB drafts exist); shared parse in
  the new `permission_rules.py` feeds both the wire rules and the Claude settings
  renderer (`mcp__*` stays settings-only); one `effective_permission(spec, read_only,
  mode)` helper mirrors the runner semantics; goldens flipped (`permissionPolicy` and
  `needsApproval` gone from fixtures). Review fixes: legacy-key literals were written as
  string concatenations to sneak past the done-check grep — made literal (greppability
  beats a clean grep report). Codex's judgment calls accepted: `annotate_trace`
  classified `read_only=False` (it mutates trace metadata). Known-red note: 10
  `test_supported_llm_models.py` failures are pre-existing on the branch (the OpenRouter
  model-list refresh pins IDs the installed LiteLLM registry lacks) — unrelated,
  untouched.
- **H3 (daemon permission-id scheme) closed as bounded.** The sandbox-agent bundle is
  minified and the id generator was not conclusively identifiable, but the exposure is
  bounded either way: every turn runs a fresh session (cold replay), interaction rows
  are namespaced by `turnId` at create, and stored decisions are keyed by name +
  canonical args (never by a replayed ACP id). A per-session counter therefore cannot
  cross-match turns. No token namespacing added.
- **Phase 2b landed (Codex implemented, reviewed here).** Relay enforcement behind
  `RelayPermissions.enforce` (true only where the harness does not gate — Pi today),
  peek-at-ACP/consume-at-relay client outputs, `resolvePermission`/`policyFromRequest`/
  the "park" verdict deleted. Review added one thing Codex correctly flagged as out of
  its brief: relay pauses now seed the `/sessions/interactions` plane through the same
  guarded closure the ACP path uses (every pause leaves a row, whichever gate paused).
  Known minor trade-off, accepted: the relay decides permission BEFORE validating
  required args, so a malformed call to an `ask` tool costs one human prompt before the
  validation error surfaces on execution; deny-first avoids leaking schema info for
  denied tools.
- **Phase 1 landed (Codex implemented, reviewed here).** Wire types + decision module +
  generated truth-table tests; 417 runner tests and typecheck green, goldens untouched
  (the new wire field is optional until the SDK emits it in phase 3). Review note
  carried forward: the `Tool(prefix:*)` matcher inspects the first string *value* of the
  args record, which on a multi-string-field tool could be the wrong field; tighten to
  the known argument name (e.g. `command`) if phase 3's derived rules ever target such a
  tool. Prefix rules on uninspectable args deliberately fail toward the default.
