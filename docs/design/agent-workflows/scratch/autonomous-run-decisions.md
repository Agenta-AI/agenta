# Autonomous run — decisions log

Context: 2026-06-24 night. User asleep; instructed me to drive ALL comment-tasks to PRs without
waiting for feedback, take decisions myself, record uncertain ones here + in PR descriptions for
morning review. Goal: nice, clear, reviewable PRs.

## Standing policy
- **POC / pre-production: no back-compat, no deprecation shims.** Make clean changes. (User:
  "remember that all of this is still poc before production.")
- comments + spin-subagent = approval-with-comments; reuse the PR; fold back when done.
- Every impl PR gets a `write-pr-description` body that states its scope AND the judgment calls.

## Decisions taken without feedback (revisit in AM)
- **D1 — #4821 design directions split.** model-always-`ModelRef` (#3469645457) → folded into
  agent-model-picker. harness/sandbox-collapsed-into-`AgentConfig` (one definition) +
  `harness_kwargs` per-harness bag with `permission_policy` as the sidecar action-permission
  (#3470018175, #3470081368, #3469634113) → a dedicated **config-structure cleanup** impl PR,
  sequenced after contract-versioning (it owns that surface now).
- **D2 — new-feature comments get plan-feature DESIGN PRs first:** HTTP MCP (#4834, plan done),
  sidecar `uri` in config (#4836, plan done — **APPROVED, impl queued**, see D7), embedref
  tools-as-workflows (#4837, plan done). Rationale: design-first; user reviews the plan, then
  approves impl.
- **D7 — sidecar-uri impl (approved via #4836 review):** per the user's review comment, the
  `uri` REPLACES the `sandbox` field — remove `sandbox` entirely; the sidecar address drives
  routing (POC, no back-compat). Queued in Round 3, sequenced with the config-structure cleanup
  (both restructure the run-selection/agent-config surface; coordinate so `sandbox` removal +
  RunSelection collapse don't fight). Reuse the #4836 branch for the impl.
- **D3 — typed `/inspect` outputs (#3470012560)** → folded into the wire-schema impl's
  `WorkflowInspectResponse` (issue 1), not a separate PR.
- **D4 — issue 4 (`stream` field)** → since POC, no deprecation note; if the wire-schema impl
  touches it, clean-remove from the public model. Otherwise leave it.
- **D5 — fold-back of the approved stack (#4833 lgtm, #4828 lgtm, #4821 lgtm-w/-comments) is
  HELD** until the stacked code chain settles: contract-versioning is stacked on #4833, so
  merging now would pull the base out from under a running agent. Will merge bottom-up at the
  end (#4821 → #4828 → #4833 → #4829 → …), or collapse the stack, whichever is clean.

- **D8 — CodeRabbit addressing deferred to the final sweep.** `@coderabbitai review` is triggered
  on each PR as it lands (per the user's rule), but addressing its comments means EDITING that
  PR's branch — and most finished PRs are lower in the stack with running agents built on top
  (#4829 has wire-schema/#4831 on it; #4831 has A7). Editing a base under a running stacked agent
  corrupts. So CodeRabbit comments are addressed in the final sweep once the impl chain is done
  and the stack is stable (spin per-PR subagents then). CodeRabbit comments stay visible on the
  PRs for the user meanwhile.

- **D9 — CodeRabbit findings: triage now, fix deliberately (not auto-fixed unattended).** All PRs
  had `@coderabbitai review` triggered. But auto-applying CodeRabbit fixes across the deep 13-PR
  GitButler stack unattended is too risky — editing a shared base lane (e.g. #4829) restacks
  every descendant and could tangle the stack you need to review. So a read-only triage digest is
  produced at `scratch/coderabbit-triage.md` (substantive vs nitpick, per PR). Substantive fixes
  to be applied deliberately with you in the morning, or as follow-ups after the stack is folded
  back to big-agents (when PRs are independent). CodeRabbit comments stay visible on each PR.

## Open questions for you (not blocking; I picked a default)
- Exact harness slug+name representation (string slug `agenta:harness:pi_core:v0` vs object
  `{slug,name}`) — defaulting to whatever the contract-versioning impl finds least-complex,
  following the existing `agenta:builtin:agent:v0` convention. See its PR description.
- Whether the config-structure cleanup (harness into AgentConfig) should also drop `RunSelection`
  entirely. Default: collapse harness/sandbox/permission_policy into AgentConfig and retire
  RunSelection if nothing else needs it. Flagged in that PR.
