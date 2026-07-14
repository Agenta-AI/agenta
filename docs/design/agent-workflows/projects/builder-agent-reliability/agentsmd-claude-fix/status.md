# Status

**State:** DESIGN ONLY. Not implemented, not merged. Under review on draft PR #5000
(`fix/agent-claude-agentsmd`, base `big-agents`).

**Date:** 2026-07-01

## What is done

- Traced the bug end to end: `instructions.agents_md` survives the SDK adapter, the wire, and
  the runner, then lands on disk as `AGENTS.md` (`workspace.ts:80`). The bundled
  `@anthropic-ai/claude-agent-sdk` memory loader auto-loads `CLAUDE.md` only, never `AGENTS.md`.
  The adapter's `settingSources` already permits `CLAUDE.md`, but none is written. So the
  instruction is written and never read. Full trace in [research.md](research.md).
- Chose the fix: make the instructions filename harness-aware in the runner materialization step
  (claude → `CLAUDE.md`, pi → `AGENTS.md`), mirrored in the SDK. This is option A ("smallest,
  works with the current stack"). See [plan.md](plan.md).
- Scoped out the deeper persona / `_meta.systemPrompt` path (option B): blocked by sandbox-agent
  0.4.2 stripping `_meta`, a cross-package change tracked for later.

## Decision

Ship option A. It alone makes `agents_md` take effect on claude, as a one-line local change with
no wire or golden-fixture churn. Option B (appended system prompt) is the real fix for the
verb-less-input persona problem but is blocked cross-package and lands separately.

## Residual behavior after A

With A, `agents_md` lands as project memory for claude, which makes it considered instead of
ignored. A strongly worded persona is honored. For a bare, verb-less paste the coding-CLI
persona can still surface; the message-composition workaround (frame the task with a verb) is
the belt-and-suspenders path until option B lands.

## Cross-references

- Parent project: [builder-agent-reliability](../README.md).
- Research source: [`../../../scratch/console/builder-kit/findings/agents-md-claude.md`](../../../scratch/console/builder-kit/findings/agents-md-claude.md).
