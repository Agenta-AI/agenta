# Status

**State: merged to `big-agents` (PR #5041, 2026-07-04).** All six plan phases landed
with per-phase review; Mahmoud reviewed and QA'd the PR. Tests green across runner
(444), SDK agents (502), and services (76), including a 40-case cross-language parity
fixture. Live QA: headless matrix 7/7; playground approve/deny/allow flows verified
(one prompt, approve resumes without looping, deny refuses cleanly) after fixing one
QA-found bug (pause teardown clobbered the prompt on the Pi relay path; fixed with a
paused-call event filter + regression tests). Before merge the branch was rebased onto
post-#5064 `big-agents` (see build-notes.md: the rebase found and fixed a real #5064
integration bug — the batch fold read `stop_reason` from a `done` event the live
runner never populates) and a CodeRabbit round fixed two real bugs (a playground
shallow merge dropping the permissions default; the client-tool pause not seeding the
interactions plane). Claude-harness live runs were blocked by account credit; that
path is covered by unit and settings-rendering tests.

## Where things stand

- PR #5041 (this workspace) is **stacked on Arda's #5054** (`big-agents-work`), per the
  merge-then-rework decision: he merges as-is, we build on top and delete what the
  redesign supersedes. The plan's "Baseline" section sorts his changes into
  kept / deleted-by-this-work / unrelated.
- The live approve-loop is **diagnosed** (details in how-approvals-work.md, live-warning
  section): a constant stream `messageId` plus a level-triggered resume predicate on the
  frontend (finding M7; fixed in the #5054 base), compounded by tool-*name* drift across
  ACP frames breaking the decision key (M2's observed form; patched in the base, kept as
  a clean recorded-name anchor inside this plan's decision module).
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

- **2026-07-03, Codex pre-implementation review (xhigh):** the design held except one
  claim. "Resume replays the approved call directly, no matching" is unimplementable for
  Claude-native builtins (the runner's only lever is the ACP reply; transcript replay is
  text, not structured tool injection). The resume section is rewritten: same-call
  matching on stable anchors per executor, drift pauses visibly. Also folded in: a single
  pending-approval latch (parallel-gate race), wire-first phase ordering with a
  `permissionsFromRequest()` legacy bridge, `ToolSpec.to_wire()` ships explicit
  permissions only, wire rules and settings rules derive from one parse (`mcp__*` rules
  stay settings-only), Pi leaves the hardcoded `"auto"` path, and a concrete test plan
  section. `SANDBOX_AGENT_DENY_PERMISSIONS` survives as an operator kill-switch.

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
5. **Resume mechanics (revised by the Codex review):** same-call matching on stable
   anchors, split by executor; drift pauses visibly for a fresh approval. Direct replay
   ("no matching") was dropped as unimplementable for harness-executed builtins.

## How this workspace was produced

Four parallel code-research passes (runner, SDK+service, frontend, API interactions
plane), a correctness review (H1-H4, M1-M7, L1-L2), an organization review, an independent
Codex design review (xhigh), a cold-reader clarity pass, two inline review rounds by
Mahmoud (38 comments total, all answered inline and folded into the docs), and the #5054
analysis that diagnosed the live loop.

## Follow-ups (filed, not in this PR)

- **Live-stream `finishReason` on a pause.** The Vercel stream adapter derives
  `finishReason` from the `done` event's `stopReason`, which the live runner never
  populates (the engine settles paused-vs-ended after the stream closes). Batch now takes
  the terminal result's value; the live stream path should too. Display is unaffected (the
  FE keys off the `interaction_request` part), so this is wire-fidelity, not UX.

- **Selection-time enforcement for Pi builtins. SHIPPED**, by the pi-builtin-gating slice
  (implemented and live-QA'd 2026-07-04). At the time this follow-up was written, Pi's
  native tools never reached a runner gate, so the global policy modes did not bind them.
  The shipped design supersedes the selection-time sketch below with call-time gating: the
  bundled Pi extension's `tool_call` hook reports each builtin call over the relay
  directory, and the runner decides it through the same shared `decide()` the relay already
  used for gateway and code tools, pausing on `ask` exactly like any other tool. The grant
  list (which builtins an author selects) is still enforced at selection time, through the
  extension's active-tool-set edit at `before_agent_start`, so a non-granted builtin is
  simply absent from the model's tools. See
  `docs/design/agent-workflows/projects/pi-builtin-gating/` for the full design and status.
  The original sketch, for context: filter `builtin_names` at resolution by effective
  permission, using a small read-only table for Pi's seven builtins (`read/grep/find/ls`
  read, `bash/edit/write` write); `deny` and un-pausable `ask` exclude the builtin
  (deny-by-omission is Pi's one native control). Until then, a per-builtin `permission` is
  dropped with a logged warning instead of silently.

## Known unknowns

- The sandbox-agent daemon's permission-request id scheme (per-session counter vs unique):
  decides whether interaction tokens need turn namespacing (code-review H3).
- How often the model regenerates different args for the same intended call on cold
  replay (plan, "Arg regeneration" risk); pinned by the phase 6 live loop.
