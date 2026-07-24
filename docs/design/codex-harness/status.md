# Status

Last updated: 2026-07-24 (Checkpoint 1 done, derisk probes and Milestone 1 running)

## Now (Milestone 1 COMPLETE and green)

- Milestone 1 (managed key, text only) implemented by Codex, reviewed by Opus. SDK +
  runner done; SDK agents unit suite 680 green, full runner suite 1218 green.
- Durable-mount blocker RESOLVED via the D-002 P8 amendment: keep `CODEX_HOME=<cwd>/.codex`
  and add `CODEX_SQLITE_HOME` (off-mount local dir) so codex's WAL SQLite state leaves the
  geesefs mount. Live QA on the real durable session path is multi-turn green: turn 1 sets
  codeword FLAMINGO-42, turn 2 (same session) recalls it, both finish=stop, no hang. On
  disk: no `*.sqlite` on the mount; all SQLite in `CODEX_SQLITE_HOME`; `sessions/` rollouts
  and the `.tmp/plugins` git clone on the mount are fine (git's `CreateLinkOp` warnings are
  benign, no wedge). Quality passes done (`/simplify`; desloppify applied manually because
  the worktree skill dirs are empty; final diff review). Details in
  `reports/m1-implementation-notes.md`.

## Earlier

- Milestone 0 done; Checkpoint 1 rulings are in: D-003 on-request, D-004
  danger-full-access, D-005 pin the bridge, D-002 managed half approved
  (`<cwd>/.codex`) with a Daytona-placeholder compatibility requirement, D-002
  subscription direction approved (mount as CODEX_HOME plus `CODEX_CONFIG` env
  channel; symlinks only as fallback).
- All derisk probes P1 through P7 are DONE (`spike/derisk-findings.md`). Outcomes:
  subscription delivery confirmed (mount plus `CODEX_CONFIG`, daemon-eviction makes
  it per-run); Daytona placeholder compatibility confirmed; symlink fallback safe
  but unneeded; P2/P6/P7 forced the D-008 pivot.
- **D-008 approved (Mahmoud, 2026-07-24): Posture 2.** Default mode
  `agent-full-access`; Agenta-tool approvals enforced runner-side at the
  `agenta-tools` pause seam; per-agent mode override for authors. Milestone 3
  rescoped accordingly (see plan.md). Upstream ask filed as a supporting comment on
  codex-acp issue #310 (decoupling approvals from full access).
- Milestone 1 implementation running (managed-key text-only slice); corrected
  mid-flight to not bake the withdrawn D-004 defaults and to observe the
  poison-combo constraint (never `sandbox_mode` inside `CODEX_CONFIG`).

## Environment

- Worktree `.claude/worktrees/codex-harness`, branch `worktree-codex-harness`, base
  main commit `7b971d8c10`.
- Deployment up at http://144.76.237.122:8180 (compose project
  `agenta-ee-dev-codex-harness`, Postgres 5433).
- QA account, project, and API key created through the UI; credentials in the
  worktree `.env` (gitignored) together with the OpenAI experiment key.

## Next (after Checkpoint 1)

- Milestone 1: managed-key text-only vertical slice (SDK skeleton, runner wiring,
  contract tests, live playground run). Early in it: verify per-run scoping of the
  adapter's `CODEX_CONFIG` environment channel (needed by D-002's subscription
  option).

## Blockers

- Checkpoint 1 rulings (see above). Nothing else.

## Checkpoint log

- 2026-07-24: plan approved by Mahmoud (worktree + own deployment, Codex gpt5.6-sol
  implements, Opus reviews, desloppify + simplify per milestone, per-milestone
  reports, no implicit decisions). Added the same day: maintain the `add-harness`
  playbook as a living skill, updated every milestone.
- 2026-07-24: Checkpoint 1 presented (D-002, D-003, D-004, D-005). Awaiting rulings.
