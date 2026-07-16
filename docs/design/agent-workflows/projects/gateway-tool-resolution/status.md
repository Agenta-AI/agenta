# Status

## Current state

Design only. No code written. This workspace plans the fix for QA finding F-019 and issues
#5173 and #5174 (symptom side).

- `context.md`, `research.md`, `design.md`, `plan.md` complete.
- The failure chain is verified in code (research.md), including the exact swallow point
  (`gateway.py` lines 111-118) and the run lifecycle fail point (`handler.py:275`).

## Recommended direction

Ship Phase 1 (surface the detail, name the tool, keep fail-fast) now. It is contained, needs
no contract change, and fully closes the opacity problem. Follow with Phase 2 (drop only a
genuinely-absent action, keep connection and auth failures fatal, warn loudly to both the
model and the user). Defer Phase 3 (config-level health UI) to a follow-up. Keep #5174
separate; the two plans share one resolvability check.

## Key findings

- The backend already emits the useful error and puts it in the HTTP body. The SDK discards
  it. So problem 1 is a one-hop drop, not a missing message. Phase 1 is genuinely small.
- All-or-nothing lives in two layers (backend `resolve_tools` raises on first bad ref; SDK
  sends one batch and raises on any non-2xx). Phase 2 must touch both.
- Symptom-handling is needed even if #5174 lands, because a committed agent rots when Composio
  removes an action after the agent was built.

## Open questions (need a decision before Phase 2 coding)

1. Warning transport for a dropped tool: run annotation, trace event, or an SDK-injected
   system message. Pick one.
2. Are any tools "required"? Should an agent whose only useful tool is the dead one fail
   rather than run tool-less? Consider a per-tool required flag or an empty-surviving-set
   rule.
3. Ownership of the shared "can this action resolve" check across this plan and #5174.

## Decisions log

- 2026-07-10: Keep #5173/F-019 (this plan) separate from #5174 (root cause). Symptom-handling
  is independently necessary. (design.md D3)
- 2026-07-10: Phase the fix. A (surface) first, B (partial resolution) second, C (config
  health) deferred. (design.md D2)
- 2026-07-10: In Phase 2, drop only genuinely-absent actions. Connection, auth, and provider
  failures stay fatal. (design.md D2 option B)

## Next steps

- Review this workspace, resolve the three open questions.
- Implement Phase 1 as its own change (SDK-only, small).
- Then scope Phase 2 with the warning transport decided.
</content>
