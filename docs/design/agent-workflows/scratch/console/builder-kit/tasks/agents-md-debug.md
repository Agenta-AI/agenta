---
id: agents-md-debug
title: Trace agents_md through the claude harness (is it dropped/ignored?)
status: done
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T14:48:40Z'
updated: '2026-07-01T14:56:54Z'
---



# Trace agents_md through the claude harness (is it dropped/ignored?)

## Context

Follow agents_md end to end in the claude harness: where the runner injects it, whether it reaches Claude's system prompt / a CLAUDE.md, and why the harness answered a bare paragraph as a chat opener. Compare to pi_core/pi_agenta. Propose a fix or kit workaround.

## Messages

**Agent** · Jul 1, 14:48

task created.

**Agent** · Jul 1, 14:56

Root cause: filename mismatch — runner writes AGENTS.md, claude-agent-sdk loads only CLAUDE.md. Instructions written-then-never-read. Fix A = write CLAUDE.md (one-file). See findings/agents-md-claude.md.
