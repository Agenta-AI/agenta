# QA plan

The release claim is stronger than "the export returned 200." It is:

> Pi produced the native span tree, the runner exported it, the trace landed under the current
> turn's trace ID, and the same behavior held for local and Daytona after multiple credential
> rotations.

## Unit coverage

### Runtime file host

- Local and fake-Daytona implementations pass the same byte contract suite.
- Binary payloads survive without UTF-8 conversion.
- Temporary names are not discoverable as final batches.
- Same-directory rename publishes complete bytes.
- Missing directories, failed stats, failed watches, and removal failures stay bounded.

### Control protocol

- Version 1 round trip.
- Unknown version rejected.
- Channel IDs sanitized and bounded.
- No endpoint or authorization field accepted or emitted.
- Redaction values accept only bounded strings, are read once, and contain no export authorization.
- Both mount credential triples and model environment values reach the redactor when already
  sandbox-visible.
- Missing propagation and baggage preserve standalone-trace defaults.
- Capture false applies to messages and tool inputs/outputs on the current turn.

### Pi serializer

- The body parses as a standard OTLP `ExportTraceServiceRequest`.
- Agent, turn, LLM, and tool spans retain parent-child relationships.
- Provider, request model, response model, usage, cost, events, status, session ID, and skill
  attributes survive serialization.
- Root-end and explicit flushes produce a zero-based sequence of complete batches, bounded to four
  files; `agent_end` produces the final remaining batch.
- Oversized batches fail closed at the spool boundary without failing the run.

### Spool consumer

- Accepts only canonical files for the expected current channel and sorts sequences numerically.
- Ignores stale, temporary, wrong-channel, non-canonical, and duplicate sequence files.
- Accepts at most four files and deletes each on pickup.
- Collects the bounded sequence before network sends, so a slow first export cannot hide a later
  published file.
- Stops cleanly after success, timeout, cancel, pause, and thrown prompt error.
- Zero accepted valid batches produce exactly one runner-owned fallback error-and-usage span,
  no partial file, bounded diagnostics, and unchanged agent-result semantics.
- Split batches retain coherent cumulative root usage after ingest recomputes the stored trace.
- Local and Daytona hosts execute the same consumer code.

### Live authorization and export

- Session-owned and standalone fake turns cross 15 minutes, two hours, and 12 hours without
  reusing the captured initial credential.
- Export reads the credential immediately before each attempt.
- A non-success response, including 401, is diagnosed after one request; there is no 401 retry.
- Third-party collector auth stays static, is not sent to `/permissions/check` or session APIs,
  and never creates a platform lease.
- Logs contain credential age and status but no secret value or OTLP content.

## Orchestration matrix

Run one table-driven suite for these cells:

| Placement | Session state                  | Turn | Expected producer | Expected network sender |
| --------- | ------------------------------ | ---: | ----------------- | ----------------------- |
| Local     | Cold                           |    1 | Pi                | Runner                  |
| Local     | Warm                           |    2 | Pi                | Runner                  |
| Local     | Warm after credential rotation |    N | Pi                | Runner                  |
| Daytona   | Cold                           |    1 | Pi                | Runner                  |
| Daytona   | Warm                           |    2 | Pi                | Runner                  |
| Daytona   | Warm after credential rotation |    N | Pi                | Runner                  |

For each cell assert:

- exactly one Pi `invoke_agent` span;
- no ACP-reconstructed duplicate agent, turn, LLM, or tool span;
- the span trace ID equals the current turn's propagated trace ID;
- a tool call has Pi's exact tool call ID, input, output, and status;
- an LLM call has Pi's provider/model and exact token/cost data;
- content is absent when capture is false;
- the HTTP sender runs in the runner test process;
- Pi receives no endpoint or export credential environment variable or control-file field.
  Redaction-only known values are permitted and must grant no export authority.

## Long-session tests without waiting 12 hours

Use fake clocks and short test TTLs.

### Many-turn warm session

1. Start a Pi environment.
2. Run turn one with trace A and capture enabled.
3. Advance past the first credential expiry.
4. Run turn two with trace B and capture disabled.
5. Repeat through enough rotations to represent 12 hours.

Assert each batch lands under its own trace, each export uses the lease's current credential, and no
turn inherits the prior turn's capture policy.

### One very long turn

Hold a fake prompt open while the credential lease crosses multiple expiries. Publish the Pi batch
only at the end. Assert the export uses the newest credential and succeeds. This covers the case
that per-turn request refresh alone cannot solve.

## Live local verification

Use the standard local deployment flow with the matching edition and environment file.

1. Run Pi locally with a prompt that makes at least one provider call and one tool call.
2. Inspect the trace and verify native provider/model, tool data, token counts, and cost.
3. Continue the same warm session after the normal token TTL.
4. Verify the later trace lands and has the later `/invoke` trace ID.
5. Toggle capture policy between turns and verify content follows the current turn.
6. Confirm runner logs show `source=pi-spool placement=local` and no direct Pi export.

## Live Daytona verification

Repeat the local scenario with Daytona placement.

Additional assertions:

- the Daytona sandbox does not need network access to the Agenta OTLP endpoint;
- the runner reads the batch through the sandbox filesystem API;
- trace details match local Pi for the same prompt shape;
- runner logs show `source=pi-spool placement=daytona`;
- no ACP-reconstructed duplicate tree appears.

## Failure injection

For cancellation, prompt failure, missing publication, a truncated final file, and an oversized
final file, assert exactly one of two outcomes: one or more valid complete Pi batches, or one
idempotent runner fallback span when none was accepted. Never accept a temporary or partial file.

- Prevent control-file write.
- Crash Pi before `agent_end`.
- Publish a truncated protobuf file under a temporary name.
- Publish an oversized final file.
- Make Daytona list or read fail transiently.
- Make the OTLP request return 401; assert exactly one request and bounded diagnostics.
- Make credential refresh fail.
- Make OTLP time out.
- Cancel and pause a turn while the consumer is active.

Every case must leave the agent result semantics unchanged, clean up the consumer, and emit a
specific bounded diagnostic.

## Regression gate

Before release:

- `pnpm test` in `services/runner`;
- `pnpm run typecheck` in `services/runner`;
- targeted Python SDK wire and tracing tests;
- API auth tests only if removing merged PR #6135 code changes API behavior;
- the agent release gate against local and Daytona deployments;
- a persisted trace inspection for both placements, because a green HTTP export alone does not
  prove span fidelity or parentage.
