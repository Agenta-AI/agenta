# Load `agents_md` on the claude harness via `CLAUDE.md`

A design-only workspace for a small runner fix. An agent configured `harness: claude` with
`instructions.agents_md` set ignores those instructions. The instruction is written to disk as
`AGENTS.md`, but the bundled `@anthropic-ai/claude-agent-sdk` memory loader auto-loads
`CLAUDE.md` only. So the file is written and never read, and the claude agent falls through to
Claude Code's default coding persona. This is the likely root of the broader "the claude agent
ignores its instructions" reports. Part of [builder-agent-reliability](../README.md).

The fix is one harness-aware line in the runner: write `CLAUDE.md` for the claude harness, keep
`AGENTS.md` for pi. The wire and the golden fixtures do not change, because the filename is a
materialization detail, not a wire-contract detail.

## Files

- [context.md](context.md), the bug, why it matters (likely root of "agent ignores its
  instructions"), and the background on how instructions reach a claude run. Goals and
  non-goals.
- [research.md](research.md), the read-only root-cause trace with file/line citations: the
  runner writes `AGENTS.md` at `workspace.ts:80`, the claude-agent-sdk loader auto-loads
  `CLAUDE.md` only, `settingSources` already permits `CLAUDE.md` but none is written. Plus the
  deeper persona `_meta` path, noted as out of scope.
- [plan.md](plan.md), the fix: the sidecar/runner materialization step writes `CLAUDE.md` for
  the claude harness and keeps `AGENTS.md` for pi, mirrored in the SDK. Options A/B/C, with A
  chosen. Verification steps.
- [status.md](status.md), current state (design under review on PR #5000) and the decision.

## TL;DR

- **Root cause:** the runner writes `instructions.agents_md` to `AGENTS.md`
  (`workspace.ts:80`), but `@anthropic-ai/claude-agent-sdk@0.2.83` auto-loads `CLAUDE.md` only.
  Written, never read.
- **Fix (option A):** make the filename harness-aware in `workspace.ts` (and mirror it in the
  SDK `interfaces.py`): claude → `CLAUDE.md`, pi → `AGENTS.md`. `settingSources` already loads a
  project-root `CLAUDE.md`, so nothing else changes. The wire and golden fixtures are untouched.
- **Out of scope (option B):** delivering `agents_md` as an appended system prompt so it
  overrides the coding persona for verb-less input. Blocked by sandbox-agent 0.4.2 stripping
  `_meta`; a separate cross-package fix.
