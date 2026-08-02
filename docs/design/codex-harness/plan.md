# Plan

Six milestones. Milestone 0 front-loads the two risky unknowns (approvals behavior and
the config-directory layout) before any production code. Every milestone is a vertical
slice with a check Mahmoud can perform himself, and ends with an Opus review, the
desloppify and simplify cleanup passes, and a written report in `reports/`.

## Milestone 0: spike and design workspace

Answer the empirical unknowns with evidence, and produce the design and decision
register.

- Spike questions (full detail in `spike/findings.md`): does `codex-acp` raise ACP
  permission requests and in what shape; does a per-run `config.toml` get respected and
  can `CODEX_HOME` separate login state from run config; do tools over the loopback MCP
  server work and produce tool events; does an OAuth `auth.json` authenticate like an
  API-key one.
- Deliverables: `research.md`, `spike/findings.md`, `design.md`, `decisions.md` with the
  proposed mount layout as a file-by-file table.
- Exit: **Checkpoint 1.** Mahmoud rules on the mount layout, the human-in-the-loop
  posture the findings support, and the handling of any permission option Codex cannot
  express. Milestones 3 and 4 are blocked until this ruling.

## Milestone 1: minimal vertical slice (managed key, text only)

- Scope: `HarnessType.CODEX`, the `CodexHarness` adapter, capabilities and model
  catalog entries, golden wire fixture; runner wiring in `environment-setup.ts`;
  `auth.json` written from the vault-resolved key.
- Tests: contract tests on the Python and TypeScript sides; a live local run through
  the product endpoint that streams a text answer.
- Mahmoud's check: pick Codex in the worktree deployment's playground and get a
  streamed reply using a managed API key.

## Milestone 2: Agenta tools

- Scope: custom and platform tools over the loopback MCP server; tool events traced.
- Tests: a live run where Codex calls a callback tool end to end, pinned as a replay
  regression test that runs without a live model.
- Mahmoud's check: a recording of the tool call in the playground, posted with the
  milestone report.

## Milestone 3: permissions and human-in-the-loop

Reshaped by D-008 (approved 2026-07-24): the default runtime is full access, where
codex raises no approvals, so tool-level human-in-the-loop is enforced by the runner
itself, not by codex config.

- Scope: runner-side tool gating at the `agenta-tools` pause seam (allow runs, ask
  parks for the UI with resume, deny refuses), wired into the existing parked-
  approval architecture; the Codex gate classification branch for authors who choose
  `agent` mode (exec frames, MCP frames with the dot naming, the join by tool-call
  id); `codex_settings.py` Layer 2/3 rendering, which applies only under `agent`
  mode; the per-agent mode override surfaced as an authored option (likely via the
  adapter's initial-mode setting; upstream issue codex-acp#310 tracks the decoupling
  we actually want).
- Standing constraint from probe P2: never emit `sandbox_mode` inside `CODEX_CONFIG`
  (silently disables all gates).
- Tests: three live scenarios, recorded: an allow tool runs without pausing; an ask
  tool parks and resumes from the UI; a deny is enforced. Park and resume tests
  mirror the existing Claude ones, now exercising the runner-side gate.
- Mahmoud's check: the recording, plus register entries for anything that proved
  inexpressible.

## Milestone 4: subscription auth through the sidecar

- Scope: the `CODEX_HOME` mount branch in `run-plan.ts` per the approved layout;
  sidecar login; Daytona plus subscription rejected exactly like Claude.
- Tests: a live run with no API key in the vault, authenticated by the operator's
  ChatGPT login.
- Mahmoud's check: the same run works on his machine after one sidecar login command.

## Milestone 5: Daytona, docs, release gate, PR train

- Scope: the Daytona asset-preparation path with managed keys only; a Codex cell in the
  agent release gate; documentation kept in sync; the work split into stacked GitButler
  lanes ready for review.
- Exit: everything green and ready to merge. Merging is Mahmoud's action.

## Standing rules

- The `add-harness` playbook (`.agents/skills/add-harness/` in this worktree) is
  updated at every milestone close: procedure changes go into SKILL.md, surprises and
  costs into resources/LESSONS.md. Its permanent home is decision D-001.

- Risky and unknown items always move to the earliest milestone that can de-risk them.
- Any decision that is not an obvious copy of the Claude pattern goes to `decisions.md`
  as proposed, and work that depends on it stops until approved.
- The OpenAI API key for experiments lives in the worktree root `.env` (gitignored) and
  never in a committed file. Mahmoud's live `~/.codex` login is read-only; subscription
  tests use a copy or the approved mount, never his directory directly.
