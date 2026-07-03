# Status

**State: implementation in progress.** Date: 2026-07-03. Three review rounds are folded
in; the final round left two small comments (both addressed below) and a green light:
implement, Mahmoud reviews the finished PR. The remaining calls listed under "Decisions
taken (delegated)" were made by the agent under an explicit "go with your decisions"
mandate; any of them can be reopened in PR review.

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
- **2026-07-03, round 3 (final review):** two comments. (1) Pi gets a settings block in
  the agent form, mirroring the Claude settings control: the author selects which Pi
  builtins the agent gets. Frontend-only; `PiAgentTemplate` and the wire already carry
  `builtin_names`. (2, from JP) the authored policy home is runner-scoped:
  `runner.permissions.default` (not bare `permissions.default`). We kept it out of
  `interactions` because an interaction is only the outcome of `ask`; `allow`/`deny`
  never produce one. Then: implement without further check-ins; Mahmoud reviews the PR.

## Decisions taken (delegated, reopenable in PR review)

1. **One-shot scope confirmed:** Option D plus visibility plus the correctness debt, one
   arc. The staged fallback stays available mid-flight if the wire change proves heavy.
2. **Names:** `runner.permissions.default` (JP's round-3 comment) and `allow_reads` for
   the fourth mode, unless the Codex design review offers a clearly better word.
3. **Pi relay-ask scope:** full. Relay `ask` pauses; that is how Pi gets HITL. If the
   turn-boundary work blows up in practice, the documented Pi-only collapse ships as an
   explicit follow-up, not silently.
4. **Batch pause shape:** minimal contract from this side: `stop_reason` plus the pending
   interaction reference. Exact field names stay coordinated with the streaming-invoke
   workspace.
5. **Direct-replay mechanics:** primary design is injecting the approved call; the
   approve-with-stored-args fallback gets picked empirically in the phase 6 live loop if
   injection proves harness-fragile.

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
