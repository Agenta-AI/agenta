## Context

Pi builtin calls hang on Daytona because the snapshot and local runner use different
`pi-acp` adapters. Local runs use 0.0.29. The Daytona snapshot inherits 0.0.23, which
predates the bridge from Pi extension dialogs to ACP permission requests. The runner sees
the tool update but never receives a permission request, so the dialog waits until the
300-second run limit ends the turn.

## What this revision changes

This remains a design-only PR. The revised workspace now identifies adapter version skew
as the root cause and recommends a small snapshot fix:

- pin the Daytona snapshot's private `pi-acp` adapter to 0.0.29;
- assert that version during the snapshot build;
- rebuild and rotate the snapshot;
- verify allow, deny, ask-live, and ask-cold behavior on fresh sandboxes.

The revision withdraws the proposed file-based permission channel. ACP remains the one
permission plane. Option C, precomputing static allow and deny decisions, is now an
independent latency idea rather than part of the correctness fix.

## Before and after

Before: the draft assumed Daytona's preview proxy dropped
`session/request_permission`, deferred root-cause work, and recommended a second file
permission protocol.

After: source and version evidence shows the old Daytona adapter never creates the request.
The plan restores adapter parity first and opens a transport fallback only if a corrected
adapter emits a request that is then proven lost.

## How to review

1. Start with `research.md` for the version proof and the preview-proxy explanation.
2. Read `options.md` for the revised A, B, and C relationship.
3. Read `plan.md` for the snapshot pin, live tests, cold-state test, and fallback gate.
4. Check `status.md` for the remaining live validation.

## Scope

No implementation code, public interface, wire shape, or configuration changes are in
this PR.
