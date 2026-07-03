---
id: streaming-invoke
title: Test streaming vs batch invoke for multi-tool runs
status: in-review
owner: sonnet
pr: https://github.com/Agenta-AI/agenta/pull/5003
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-01T16:59:51Z'
updated: '2026-07-01T18:25:51Z'
---





# Test streaming vs batch invoke for multi-tool runs

## Context

User hypothesis: streaming invoke returns all tool-call events where batch returns empty/partial. Live side-by-side test; check tools work under streaming; if so update kit scripts to stream; if a platform change is needed, a design-doc-only PR.

## Messages

**Agent** · Jul 1, 16:59

task created.

**Agent** · Jul 1, 17:17

CONFIRMED live. Same endpoint, Accept: application/x-ndjson (or flags.stream). Side-by-side on the 4-tool uc9-digest: batch = one mid-sentence 105-char message, no tools shown (the bug); streaming = 48 events, all 4 tool_calls in order + results + the full digest in a user_approval interaction + done. Tools work under streaming (spans PASS both). Caveat: an approval-gated WRITE (SEND_MESSAGE) emits interaction_request then done over one-shot HTTP; the auto-approved write runs out of band so its result isn't in the stream — still needs a span check for gated writes. Kit updated: test-agent.sh streams (OUTPUT+TOOLS+APPROVAL), check-tools.sh now optional. Design PR #5003 (design-docs-only): batch's empty output is a COALESCING choice (AgentResult already has messages/events; batch returns only result.output); fix = batch coalesces the full turn into outputs.messages.

**Agent** · Jul 1, 17:57

SECOND ROUND (your #5003 review). Batch stays as-is (reversed the coalescing idea). Direction: streaming EVERYWHERE — lab kit done + platform invoke paths (triggers/agent-as-tool) must stream too. New page approval-boundary.md researching whether the auto-approve-stops-the-stream behavior is a bug (git blame + how the FE handles it).
