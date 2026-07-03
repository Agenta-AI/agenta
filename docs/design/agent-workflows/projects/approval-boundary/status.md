# Status

**State: plan ready for final review.** Date: 2026-07-03. Two review rounds on the
explainer are addressed; the plan and reviews are updated to match. Next step: Mahmoud's
final pass over plan.md (and the remaining decisions below), then implementation.

## Where things stand

- PR #5041 (this workspace) is **stacked on Arda's #5054** (`big-agents-work`), per the
  merge-then-rework decision: he merges as-is, we build on top and delete what the
  redesign supersedes. The plan's "Baseline" section sorts his changes into
  kept / deleted-by-this-work / unrelated.
- The live approve-loop is **diagnosed** (details in how-approvals-work.md, live-warning
  section): a constant stream `messageId` plus a level-triggered resume predicate on the
  frontend (finding M7; fixed in the #5054 base), compounded by tool-*name* drift across
  ACP frames breaking the decision key (M2's observed form; patched in the base, properly
  removed by this plan's direct-replay resume).
- The permission model is settled (round 2): per-tool `allow | ask | deny` or inherit; one
  global policy with four modes (`allow`, `ask`, `deny`, `allow_reads` = reads run, writes
  ask); `needs_approval` and the legacy aliases get deleted; "effective permission"
  replaces the term "disposition".

## Decisions taken (Mahmoud)

- **2026-07-02:** auto means auto everywhere (an auto-approved tool runs without
  prompting, on every surface); docs+plan PR first, implementation separate; no
  backward-compatibility constraints.
- **2026-07-03, round 1:** deciding and executing are separate jobs (the relay carries no
  permission logic; one central decision on our side); client tools go through the same
  ladder, defaulting to `allow`.
- **2026-07-03, round 2:** #5054 merges as-is, we rework stacked on it. Delete
  `needs_approval` outright. "Reads always allowed" becomes an explicit global policy
  mode instead of an opaque per-tool default. Rename "disposition" to "effective
  permission".

## Decisions still open

1. **Confirm the one-shot scope** (plan = Option D plus visibility plus the correctness
   debt, in one implementation arc). The staged fallback exists mid-flight if the wire
   change proves heavy.
2. **Names.** `permissions.default` as the authored home of the policy, and the name of
   the fourth mode (`allow_reads` is the placeholder; alternatives: `read_only_auto`,
   `ask_writes`). Cheap to decide, touches FE form + SDK + wire once.
3. **Pi relay-ask scope.** The plan makes relay `ask` pause (that is how Pi gets HITL). If
   the relay's turn-boundary work proves heavy, is a documented Pi-only collapse
   acceptable for the first slice? Stakes: under the collapse, an `ask` tool on Pi
   silently runs or is refused per the policy instead of pausing.
4. **Batch pause shape.** Coordinate exact fields with the streaming-invoke workspace;
   this side only requires "paused is distinguishable and names the pending interaction".
5. **Direct-replay mechanics** (flagged, not blocking): when the re-raised gate does not
   match the approved call, the runner injects the approved call's execution; if that
   proves harness-fragile in the phase 6 live loop, the fallback is approving the
   re-raised gate but executing with the approved arguments. Empirical; the plan carries
   both.

## How this workspace was produced

Four parallel code-research passes (runner, SDK+service, frontend, API interactions
plane), a correctness review (H1-H4, M1-M7, L1-L2), an organization review, an independent
Codex design review (xhigh), a cold-reader clarity pass, two inline review rounds by
Mahmoud (38 comments total, all answered inline and folded into the docs), and the #5054
analysis that diagnosed the live loop.

## Known unknowns

- The sandbox-agent daemon's permission-request id scheme (per-session counter vs unique):
  decides whether interaction tokens need turn namespacing (code-review H3).
- Whether ending a parked turn and later injecting the approved call behaves cleanly on
  Claude (plan, "Direct replay" risk); pinned by the phase 6 live loop.
