---
id: fix-agentsmd-claude
title: Fix agents_md delivery for the claude harness (real bug)
status: locked
task: agents-md-debug
pr: ''
recommendation: (a) now — it makes instructions actually load with a one-file change
  and fixes the ignored-instructions bug directly. Consider (c) later for a stronger
  persona override against Claude Code's default coding voice. This is the second
  real bug of the sweep (with reference-only) and arguably the highest-impact one
  for agent reliability.
answer: 'Do it, in the Claude adapter: the claude agent template should write CLAUDE.md,
  and the adapter (sidecar) takes AGENTS.md and writes it to CLAUDE.md. Research +
  plan-feature + draft PR with docs.'
answered_by: user
raised: '2026-07-01T14:56:54Z'
updated: '2026-07-01T15:21:45Z'
---



# Fix agents_md delivery for the claude harness (real bug)

## Context

The claude harness materializes the agent's instructions (agents_md) as a file named AGENTS.md in the run cwd (services/agent workspace.ts:80), but the bundled @anthropic-ai/claude-agent-sdk memory loader only auto-loads CLAUDE.md / .claude/CLAUDE.md, never AGENTS.md. settingSources already permits CLAUDE.md, but the runner never writes one. So the agent's instructions are written to disk and never read — literally ignored. This is why a claude agent ignored its summarizer instructions and answered a bare paragraph as a coding assistant. Confirmed in code; findings/agents-md-claude.md.

## Options

- (a) Smallest: write agents_md to CLAUDE.md/.claude/CLAUDE.md for the claude harness (settingSources already loads it). One-file change in workspace.ts. My rec.
- (b) Persona fix: thread agents_md as a system-prompt append (_meta.systemPrompt.append); needs sandbox-agent to expose the _meta hook first. Bigger.
- (c) Both, mirroring Pi's AGENTS.md-preamble + append_system split.

## Recommendation

(a) now — it makes instructions actually load with a one-file change and fixes the ignored-instructions bug directly. Consider (c) later for a stronger persona override against Claude Code's default coding voice. This is the second real bug of the sweep (with reference-only) and arguably the highest-impact one for agent reliability.

## Your decision

**Locked:** Do it, in the Claude adapter: the claude agent template should write CLAUDE.md, and the adapter (sidecar) takes AGENTS.md and writes it to CLAUDE.md. Research + plan-feature + draft PR with docs.

Greenlit. Dispatching an implementation subagent: research the Python + sidecar claude adapters, plan-feature, implement (adapter writes CLAUDE.md from agents_md for the claude harness), write-pr-description, draft PR base big-agents. Tracked as task agentsmd-fix-impl.

_2026-07-01T15:21:45Z_
