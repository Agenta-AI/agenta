---
id: claude-and-agents-md
code: CLA-8
title: Claude and Agents.md
status: waiting
needs_reply: false
promoted_to: ''
created: '2026-07-01T14:09:45Z'
updated: '2026-07-01T18:41:37Z'
---











# Claude and Agents.md

## Summary

IMPLEMENTED via split: #5000 SDK half (implementing) + NEW #5007 runner half (the live CLAUDE.md fix, needs-review). Tests green, both draft, cross-linked. Needs a sidecar redeploy to verify live. Awaiting your review.

## Messages


**You** · Jul 1, 14:09

I have discovered that the agents.md is not considered at all in claude. it ignores it for example in the example of summaruizataion although the agents.md was there the agent was confused why we sent it a message. spion of a subagent to debug this. basically follow what happens to agents.md in the case of claude. probably when we changed it to become under instruction.agents_md something failed.

**Agent** · Jul 1, 14:48

On it. This is the persona-override symptom from the overnight run (claude harness answered a bare paragraph as a chat opener despite the agents_md), now chased to root. Spinning a subagent to trace exactly what happens to agents_md in the claude harness: where the runner injects it (Claude system prompt vs a materialized CLAUDE.md/AGENTS.md file), whether it is dropped or reordered for the claude harness specifically, and how it compares to how pi_core/pi_agenta consume it. Findings + a concrete fix or kit workaround to follow.

**Agent** · Jul 1, 14:56

You were right, and it is a real bug with a small fix. Full trace in findings/agents-md-claude.md.

What happens: for the claude harness, `agents_md` is materialized ONLY as a file named `AGENTS.md` in the run's working directory (`workspace.ts:80`). It is never folded into the prompt, and the `systemPrompt`/`appendSystemPrompt` paths are gated behind `isPi`, so claude gets neither.

Why it is ignored: the bundled `@anthropic-ai/claude-agent-sdk` memory loader auto-loads `CLAUDE.md` / `.claude/CLAUDE.md` / `CLAUDE.local.md` only. It never loads `AGENTS.md`. The adapter already sets `settingSources: [user, project, local]`, which WOULD load a `CLAUDE.md` if one existed, but the runner writes `AGENTS.md`, not `CLAUDE.md`. So the instructions are written to disk and then never read. Literally a filename mismatch.

That is the whole summarizer symptom: the agent never saw its "you are a summarizer" instructions, so a verb-less paste fell through to Claude Code's default coding-assistant persona ("can I help with a coding task?").

Fixes at the source:
- (A, smallest) for the claude harness, write `agents_md` to `CLAUDE.md` / `.claude/CLAUDE.md` instead of (or in addition to) `AGENTS.md`. `settingSources` already loads it, so it becomes "considered." One-file change in `workspace.ts`.
- (B, stronger persona) thread `agents_md` as a system-prompt append (`_meta.systemPrompt.append`). The Zed adapter honors it, but sandbox-agent 0.4.2 strips `_meta` from session init, so it must first expose that hook. Bigger change.
- (C) both, mirroring how Pi already splits an AGENTS.md preamble plus an append_system persona.

Kit workaround we already use: frame the task with an explicit verb ("Summarize the following text:"). The coding persona still executes an explicit instruction; only bare pastes fall through. But that is a workaround, not the fix.

**You** · Jul 1, 15:09

this is a redundant thread why we have a redundant thread

**Agent** · Jul 1, 15:21

You are right, this is now redundant. This was the debug thread; it did its job (found the AGENTS.md-vs-CLAUDE.md bug). The action lives in the decision fix-agentsmd-claude and the fix PR now being built. Resolving this thread; follow it there.

**Agent** · Jul 1, 17:01

You approved the design on PR #5000 (I agree on the Options, Option A: write CLAUDE.md for the claude harness). Design approved. On your go I'll implement the one-file change (workspace.ts picks CLAUDE.md for claude, AGENTS.md for pi), flip the PR to implementing, and we work through #5000.

**Agent** · Jul 1, 18:41

Implemented and split across two draft PRs: #5000 carries the SDK half (interfaces.py, label lgtm+implementing), and NEW PR #5007 carries the runner half (workspace.ts) — the live fix that makes the claude harness write CLAUDE.md. Both tests green (454 SDK + 10/10 runner), cross-linked. Live verification needs a sidecar redeploy. Review both when you're ready.
