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
