# Open design questions

> **AGENT-GENERATED, low weight.**

Only unresolved questions that block or materially change implementation belong here. Move an
answer to `decisions.md` when it settles.

## Repaired records as permanent session history

The current direction repairs records instead of adding a separate `session_events` table. Before
implementation, confirm that session retention can be separated from tracing quota and that Spike
D found every progressive record update. This blocks immutable history and replay.

## Durable event payloads

The event vocabulary is selected, but exact payload fields remain unspecified. Freeze identifiers,
terminal outcome fields, error fields, and entity payloads before API and client branches begin.

## Live-frame limits

The design requires age and size limits for Redis frames and per-reader buffers. Measure real text,
tool, and long-execution traffic before choosing the numbers. This blocks the production relay, not
the frame-envelope prototype.

## Public URL spelling

The public operations are settled, but final endpoint names are not. Resolve names before exposing
new routes outside first-party clients.

## Codex cancellation implementation

Test the current Codex ACP pin and a current version on local and Daytona. If the upgrade stops tool
children and passes cancellation, approvals, tools, and warm continuation, use it. Otherwise review
the runner-side cleanup from PR #6496.

## Runner shutdown grace

Measure the final bounded cleanup path and set the container shutdown grace above it. This blocks
the reliable-control release, not implementation review.

## Claude Code shell permissions

Evidence shows that the built-in shell tool may not honor the general `ask` permission while other
tools do. Track and resolve this as a security issue. Do not claim that the policy gates shell use
until a test proves it.
