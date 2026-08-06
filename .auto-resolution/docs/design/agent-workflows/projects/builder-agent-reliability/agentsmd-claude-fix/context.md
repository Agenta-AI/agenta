# Context

Date: 2026-07-01
Area: the sidecar runner file-materialization step
(`services/agent/src/engines/sandbox_agent/workspace.ts`), mirrored in the SDK
(`sdks/python/agenta/sdk/agents/interfaces.py`).

## The bug

An agent configured `harness: claude` with `instructions.agents_md` set (for example, "You are
a text summarizer, summarize the text, no questions back") ignores those instructions. Sent a
bare pasted paragraph with no instruction verb, it answers like the Claude Code CLI ("Is there
something I can help with, a coding task?") instead of summarizing.

The user's read was: "agents.md is not considered at all in claude, it ignores it." That
observation is correct. For the claude harness the instructions are written to disk and never
read.

## Why it matters

This is the likely root of the broader "agent ignores its instructions" complaints on the
claude harness. It is not a dropped field or a mapper bug. The instruction survives the SDK
adapter, survives the wire, survives the runner, and lands on disk. It is simply written to a
filename the claude memory loader never reads. So every claude agent that relies on
`instructions.agents_md` to set its behavior falls through to Claude Code's default coding
persona, no matter what the user wrote.

Pi is unaffected. Pi reads `AGENTS.md`, and additionally gets `agents_md` appended after its
system prompt, so the instruction takes effect there.

## Background: how instructions reach a claude run

`instructions.agents_md` is carried as a neutral `agentsMd` string on the `/run` wire. The wire
says nothing about a filename. The runner is the component that turns `agentsMd` into a file on
disk in the run cwd, and it writes the file as `AGENTS.md` for every harness. Claude runs
through the bundled `@anthropic-ai/claude-agent-sdk`, whose memory loader auto-loads `CLAUDE.md`
only. The two never meet. The full file-by-file trace is in [research.md](research.md).

## Goals

- Make `instructions.agents_md` actually take effect on the claude harness: land it as project
  memory the claude-agent-sdk loads.
- Keep the change in the one place that owns the filename (the runner materialization step),
  and keep it small.
- Keep Pi and Agenta behavior unchanged.

## Non-goals

- The persona / system-prompt path. Delivering `agents_md` as an *appended system prompt* so it
  overrides the coding persona for verb-less input is a larger cross-package change (blocked by
  `sandbox-agent` 0.4.2 stripping `_meta`). It is out of scope here and tracked in
  [research.md](research.md) and [plan.md](plan.md) as the deeper fix.
- Any wire-contract or golden-fixture change. The filename is not on the wire.
