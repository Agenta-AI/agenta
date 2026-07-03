---
id: multitool-output
code: MUL-4
title: Multi-tool runs return an unreliable invoke output — explain more
status: waiting
needs_reply: false
promoted_to: ''
created: '2026-07-01T13:54:47Z'
updated: '2026-07-01T18:25:55Z'
hidden: false
---












# Multi-tool runs return an unreliable invoke output — explain more

## Summary

Second round on #5003 is up (design-docs-only). Two findings: (1) the platform's agent-as-tool invoke uses BATCH, so an agent calling another app or agent as a tool reproduces the empty-output bug. Proposed a draining streaming variant; convert agent-as-tool first. (2) The approval-boundary IS a confirmed bug: an auto-approved run parks at the gate instead of consulting the auto policy (`responder.ts:257`, introduced 2026-06-25 in commit `b109cc51ef`). The playground hides it by auto-resending; a one-shot HTTP invoke cannot. New page `approval-boundary.md`. Review on #5003.

## Messages


**Agent** · Jul 1, 13:54

User: explain the multi-tool unreliable-output finding more, use /style-editing.

**Agent** · Jul 1, 13:57

When an agent uses several tools in one run, the reply you get back can lie about what happened.

Take the digest agent. It lists your Slack channels, reads GitHub issues, reads commits, then posts the digest to Slack. All four tool calls succeed. But the text the invoke returns comes back empty, or cut off mid-sentence, like "Now I'll post the digest to #social:". The work is done. The reply does not show it.

So the reply text is not a reliable sign of success. An empty reply does not mean the agent failed.

Two things cause this:

- **The run ends on the turn that calls the tools.** The agent does not always get a final turn to write "done, here is what I posted." So the service returns the last thing it said, even when that was half a sentence before the real work.
- **Sometimes the agent stops early.** It does the reads, then wanders off (into its own builtins, or "let me check the triggers"), and never reaches the last tool. That also returns no error. The job simply is not finished.

To know what really happened, read the trace, not the reply. The trace records every tool the run called and whether each one succeeded. The kit does this with `check-tools.sh`: give it the trace id and the tool that must run last, such as `SEND_MESSAGE`, and it prints `PASS` or `INCOMPLETE`.

Why this is a product gap: a caller should be able to trust the response. Today it cannot. You have to inspect spans to learn whether the job finished. That is both an observability problem and a contract problem, and it is worth fixing at the source, not just working around in the kit.

**You** · Jul 1, 16:34

Why can't we use invoke with streaming here? I think invoke with streaming returns all the tool calls because it returns all the events. invoke that is batch does not return these. I think the solution is not to use tracing, but to use invoke with streaming. 

Can the agent use the tool with Streaming, or does the tool that exists not use Streaming and cannot use Streaming? Please check that.

Create a subagent that first checks whether the multi-tool run, when called with Streaming, succeeds or not, and shows the results compared to running without Streaming. If that is the case, look at the platform tool you implement and whether it uses Streaming or can be used with Streaming. If it needs to be changed, create a draft PR with design docs, as always, never with code, just design docs using Gilead and gitbutler. Also look at your implementation of the shell scripts and whether you fix that to use invoke with Streaming.

**Agent** · Jul 1, 16:59

On it. A subagent is testing streaming vs batch invoke live on a multi-tool run to see if streaming returns all the tool-call events (your hypothesis), and whether the tools work under streaming. If yes, it updates the kit scripts to stream; if the platform needs a change, a design-doc-only PR.

**Agent** · Jul 1, 17:17

Confirmed live, your hypothesis was right. Streaming invoke (same endpoint, Accept: application/x-ndjson) returns EVERY event. Side-by-side on the 4-tool digest agent: batch came back as one mid-sentence 105-char message with no tools shown (the bug); streaming returned 48 events — all 4 tool calls in order, their results, and the full digest carried in a user_approval interaction, then done. Self-describing, no trace needed. Tools work under streaming. One real caveat: an approval-gated WRITE (SEND_MESSAGE hit a user_approval gate) emits the interaction_request then done over a one-shot HTTP invoke; the auto-approved write runs out of band, so its final ok-result is NOT in the stream — a gated write still needs a span check to confirm it completed. I updated the kit (test-agent.sh now streams and prints a TOOLS line; check-tools.sh is now optional). And I filed a design PR #5003: the batch empty-output is a coalescing choice, not a limitation (the result already carries all messages/events; batch just returns the final text), so the fix is to have batch coalesce the whole turn into outputs.messages. Review on #5003.
