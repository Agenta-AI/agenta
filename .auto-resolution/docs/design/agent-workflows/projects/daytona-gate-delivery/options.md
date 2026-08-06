# Fix directions

The options are not equal after the root-cause investigation. Option A is now a small,
evidence-backed correctness fix. Option B is a contingency. Option C is an independent
latency optimization.

## Option A: restore adapter parity and keep ACP as the permission plane

Rebuild the Daytona snapshot with `pi-acp` 0.0.29, matching the local runner. Install it
through `sandbox-agent install-agent pi --reinstall --agent-process-version 0.0.29` so the
private adapter launcher is updated, then verify allow, deny, and ask on a fresh sandbox.

- What it buys. The existing Pi dialog becomes `session/request_permission` on Daytona,
  exactly as it does locally. The runner keeps one decision path, one live parking path,
  and one cold replay path. No new wire shape or trust boundary is required.
- What it costs. One snapshot recipe change, one dependency assertion, a forced snapshot
  rebuild, draining sandboxes created from the old snapshot, and focused live QA. This is
  hours of work, not a transport project.
- What remains uncertain. The currently deployed snapshot should be queried once to
  confirm its private adapter version. The recipe and base-image manifest already prove
  what a snapshot built from the checked-in recipe contains.

Verdict: adopt as the primary fix.

## Option B: add a file-based permission channel

Have the Pi extension write permission requests into the existing Daytona relay directory,
then have the runner poll, decide, and write authenticated responses.

- What it buys. A permission route that does not use ACP reverse requests.
- What it costs. A second permission protocol, new integrity credentials, new delivery
  acknowledgments, new cleanup and timeout rules, and separate live and cold behavior.
  It duplicates a path that already works when the correct adapter is installed.
- When it is justified. Only if a fresh sandbox with the pinned adapter emits
  `session/request_permission` at the adapter boundary but a focused signed-preview test
  proves that the envelope cannot traverse the managed proxy reliably.

Verdict: reject for now. Keep it as a documented contingency, not planned work.

## Option C: precompute static builtin decisions

Compile statically known allow and deny decisions on the runner and inject those decisions
beside the builtin grant list. The extension skips ACP for those calls. Ask and
argument-dependent rules still use ACP.

- What it buys. Fewer remote round-trips for common allow and deny calls.
- What it costs. Policy-derived state moves into the sandbox, validation logic grows, and
  local and remote behavior change even though Option A already restores correctness.
- Dependency. Option C does not depend on Option B. It needs a working runner channel for
  residual decisions. With Option A, that channel is ACP.

Verdict: defer until measurements show that the ACP round-trip materially affects tool
latency. It is not part of the F-018 correctness fix.

## Recommendation

Implement Option A and verify it before designing another channel.

1. Pin `pi-acp` 0.0.29 in the Daytona snapshot recipe and assert the installed private
   adapter version.
2. Rebuild the snapshot and drain old sandboxes.
3. Verify Pi builtin allow, deny, and ask over the signed preview path.
4. Verify both approval lifecycles:
   - live: answer the held ACP permission id and continue the original call;
   - cold: store the human decision, restart or recreate, and answer the reissued gate.
5. Test Claude ask on Daytona separately. F-018 proves the Pi adapter failure, not a
   Claude failure.
6. Consider Option C only after measuring round-trip latency.
7. Reopen Option B only if adapter-boundary instrumentation proves that a real permission
   envelope is emitted and then lost in transport.
