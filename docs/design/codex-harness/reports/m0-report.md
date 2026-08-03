# Milestone 0 report: spike and design workspace

Date: 2026-07-24. Audience: Mahmoud. Everything referenced lives in
`docs/design/codex-harness/` in the `codex-harness` worktree.

## Headline

Every risky unknown resolved in our favor. Codex behind the sandbox-agent daemon
raises real, classifiable permission requests; a throwaway `CODEX_HOME` gives us full
config control; Agenta tools work over both delivery channels, including the
per-tool pre-allow we need so "allow" tools run without pausing; and all three
credential forms authenticate, including a copy of your ChatGPT OAuth login. No
daemon changes are needed. Four decisions now need your ruling (Checkpoint 1) before
Milestones 1, 3, and 4 build on them.

## What was produced

- `research.md`: the map of the current harness code on main, with file anchors.
- `spike/findings.md`: the four spike questions answered with verdicts, exact frame
  shapes, and 18 raw transcripts from the real daemon path (same pinned and patched
  package the runner uses). Nothing was inferred from documentation alone.
- `design.md`: the integration design, mirroring the Claude pattern layer by layer.
- `decisions.md`: D-001 through D-007.
- The `add-harness` playbook skill (your ask from today), seeded with 14 lessons.
- Working environment: the worktree deployment at http://<dev-host>:8180, with a
  QA account, project, and API key created through the UI (which doubled as a signup
  smoke test of main; two minor UI observations noted in the findings, nothing
  blocking).

## The four spike verdicts, in one paragraph each

**Approvals work.** Under `approval_policy = "untrusted"`, every command pauses and
an ACP permission request reaches the exact channel the runner already consumes for
Claude; `on-request` and `on-failure` gate escalations; `never` gates nothing;
rejecting a request fails the tool call and the turn continues. The frames differ
from Claude's in three known ways (exec gates carry no tool name, MCP gates carry no
arguments and need a join by tool-call id, and MCP tools are named with dots), all
recorded precisely enough to write the classification branch and its tests.

**Config control works.** `CODEX_HOME` passes through the whole process chain, and a
throwaway directory holding our rendered `config.toml` is fully honored, including
codex writing its own state there. Two bonus channels surfaced: `CODEX_CONFIG`, an
environment JSON merged into every session's config that can also loosen settings,
and `CODEX_PATH` to force a specific binary. One hazard: codex also reads config
files found in the session working directory (tighten-only), so a user repo can
influence gating; registered as a GA follow-up (D-007).

**Tool delivery works, including pre-allow.** Our MCP server shape is accepted both
through the ACP session request (the runner's existing path) and through
`config.toml`. Tool calls appear as normal tool-call events with full input and
output. Crucially, setting a server's `default_tools_approval_mode = "approve"` ran
the tool with zero pauses even under the strictest approval policy, which is the
Codex equivalent of Claude's per-tool allow rules; per-tool overrides and
enable/disable lists exist too. Milestone 3's permission mapping therefore has a
complete target vocabulary.

**All auth forms work.** A pre-seeded `auth.json` with the API key is the simplest
managed setup (no environment key needed). An environment key alone fails unless the
adapter's auto-login variable is set; worth knowing, easy to handle. A copy of your
ChatGPT OAuth `auth.json` authenticated through the daemon path; your live `~/.codex`
was never opened for writing, and no token refresh occurred during the test, so
refresh-against-a-copy remains the one untested corner (it shapes D-002's
subscription option).

## Surprises worth your attention

1. The Codex ACP bridge is installed unpinned from a registry CDN at first use, with
   a floating version range; the Claude bridge is pinned. Its version defines the
   frame shapes we classify. D-005 proposes pinning it.
2. Codex's own OS sandbox cannot initialize inside containers, so inside our
   infrastructure codex cannot self-sandbox; the Agenta sandbox is the real boundary,
   same as with Claude. D-004 proposes the matching default.
3. The current model generation is gpt-5.6 (sol default, luna cheapest); the
   gpt-5.1-codex family still appears in listings but is rejected by the backend, and
   the daemon's embedded default model is from a deprecated family, so we always pass
   the model explicitly.

## Checkpoint 1: the four rulings

Full context and trade-offs in `decisions.md`; recommendations in one line each:

- **D-002, CODEX_HOME layout.** Managed mode: put it at `<cwd>/.codex` so the config
  file rides the existing blind-writer seam and the runner only adds the credential
  file (recommended). Subscription mode: mount your codex directory directly as
  `CODEX_HOME` (refresh keeps working) and deliver run config via `CODEX_CONFIG`,
  pending one per-run-scoping check; fallback is tighten-only workspace files with a
  registered degradation (allow-tools would pause on subscription runs).
- **D-003, default approval policy.** `on-request` (codex's own default; commands
  run, escalations pause and park properly).
- **D-004, sandbox mode inside our containers.** `danger-full-access` for the inner
  codex process, because the container or VM is the enforced boundary and codex's
  inner sandbox cannot start there anyway; Layer-2 reinforcement still maps read-only
  boundaries down.
- **D-005, adapter pinning.** Pin at a fixed version (pre-install at bootstrap now,
  bake into images at Milestone 5).

Milestone 1 (managed-key text slice) starts as soon as D-002's managed half is
ruled; D-003 and D-004 gate Milestone 3, and D-002's subscription half gates
Milestone 4.
