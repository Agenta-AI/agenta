# Reviewer protocol: runner-owned Pi trace export

Use this protocol to review the implementation PR. The PR targets
`release/v0.114.0` and depends on:

- #6217 for refreshed platform credentials at the runner export boundary.
- #6218 for preserving Secret token timing and authentication errors.

Review those contracts before judging the credential behavior in this PR.

## Intended result

Pi still creates its native span tree. Pi does not send the spans over the
network. At the end of a turn, Pi serializes a standard OTLP protobuf request
and atomically publishes the bytes to a private telemetry directory. The runner
picks up those bytes and sends them through its normal OTLP endpoint and
credential boundary.

Local and Daytona use the same protocol and runner consumer. Only the file host
adapter changes:

- Local uses bounded file-descriptor reads on the shared filesystem.
- Daytona bounds the read inside the sandbox and also caps the sandbox process
  response before decoding it in the runner.

## Scope boundaries

The PR intentionally does not add:

- a longer-lived Pi credential;
- an endpoint or authorization header in the Pi control file;
- a custom trace DTO or a second trace schema;
- an exporter-specific 401 retry protocol;
- a feature flag;
- a separate Daytona export path.

If any of those appear in the diff, treat the change as a scope regression.

## Review order

### 1. Standard byte format

Read these files first:

- `src/tracing/otel.ts`
- `src/tracing/pi-file-exporter.ts`
- `src/tracing/pi-spool-protocol.ts`
- `src/extensions/agenta.ts`

Verify that Pi serializes an OTLP `ExportTraceServiceRequest` and writes the
exact protobuf bytes. The extension must instantiate the atomic file transport. Its bundle must not
contain the runner-only `exportOtlpBytes` helper or spool consumer; it may share the tracer
and standard OTLP serializer with runner tracing.

Run:

```bash
cd services/runner
pnpm run build:extension
pnpm exec vitest run --project unit \
  tests/unit/otel-trace-serialization.test.ts \
  tests/unit/pi-file-exporter.test.ts \
  tests/unit/pi-spool-protocol.test.ts \
  tests/unit/extension-tools.test.ts
```

### 2. Process boundary and secrets

Read:

- `src/engines/sandbox_agent/run-turn.ts`
- `src/engines/sandbox_agent/pi-assets.ts`
- `src/redaction.ts`

Verify these invariants:

- The Pi control file contains capture policy, propagation, skills, known
  redaction values, and a random channel ID.
- It contains no OTLP endpoint and no authorization value.
- Runner and mount credentials are included in known-value redaction.
- The control file is published atomically and consumed once per turn.
- A warm Pi session resets its tracer and usage state before the next turn.

### 3. Local and Daytona adapters

Read:

- `src/engines/sandbox_agent/workspace.ts`
- `src/tracing/telemetry-file-host.ts`
- `src/tracing/pi-spool-consumer.ts`

Verify that both placements create the same telemetry directory shape and feed
the same consumer. Confirm the limits remain bounded: four batches per turn,
8 MiB per batch, bounded directory listings, and bounded reads. Pickup deletes
the file before network export so a later poll cannot forward it twice.

Run:

```bash
cd services/runner
pnpm exec vitest run --project unit \
  tests/unit/telemetry-file-host.test.ts \
  tests/unit/pi-spool-consumer.test.ts \
  tests/unit/sandbox-agent-workspace.test.ts
```

### 4. Runner-owned authorization and lifecycle

Read:

- `src/engines/sandbox_agent/runtime-policy.ts`
- `src/tracing/pi-trace-turn-export.ts`
- `src/tracing/otlp-bytes-export.ts`
- `src/engines/sandbox_agent/environment.ts`
- `src/engines/sandbox_agent/run-turn.ts`

Verify that Agenta ingest reads the current platform authorization immediately
before export. A third-party collector must keep its configured exporter
authorization and must never receive the platform token.

Trace finalization must cover normal completion, cancellation, an approval
pause, approval resume, and parked-environment eviction. A resumed approval must
keep the original Pi trace ID. The runner may emit its fallback span only when
Pi produced no valid batch, and the fallback callback must be idempotent.

Run:

```bash
cd services/runner
pnpm exec vitest run --project unit \
  tests/unit/otel-bytes-export.test.ts \
  tests/unit/pi-trace-turn-export.test.ts \
  tests/unit/sandbox-agent-orchestration.test.ts \
  tests/unit/session-keepalive-approval.test.ts
```

### 5. Review-fix invariants

Use these checks for the follow-up commit that addresses the first review round:

- Call `finish()` twice and then call `teardown()`. The runner must perform one pickup,
  one HTTP request, and return the same counts to every caller.
- Read `pickedUpBatches` as the number of valid protobuf files accepted by the runner.
  Read `exportedBatches` as the subset accepted by the collector. A 401 can reduce the
  second count, but it must not create a missing-Pi fallback.
- Confirm the control-file deny set includes `modelConnection.environment` values that
  already enter the Pi process. It must still exclude the runner OTLP authorization.
- For Agenta ingest, resolve a blank request authorization through the same live
  `AGENTA_CREDENTIALS` fallback used by ordinary runner spans. Do not apply that
  fallback to a third-party collector.
- During finalization, drain the current channel before the bounded sweep. A valid late
  batch must reach the export callback instead of being deleted as residue.
- Treat a missing Daytona telemetry directory as an empty list. Reject a missing,
  truncated, or zero-byte Daytona read before building an HTTP request.
- Increment the Pi file sequence only after the atomic rename succeeds. Reject
  non-canonical sequence spellings such as `02`; cleanup may remove them, but the
  consumer must never forward them.
- Keep parent-first ordering inside `serializeTraceBatch` for Pi. Apply the separate
  ordering pass only to the ordinary HTTP exporter.

Run the focused review-fix suite:

```bash
cd services/runner
pnpm exec vitest run --project unit \
  tests/unit/pi-file-exporter.test.ts \
  tests/unit/pi-spool-consumer.test.ts \
  tests/unit/pi-trace-turn-export.test.ts \
  tests/unit/telemetry-file-host.test.ts \
  tests/unit/sandbox-agent-orchestration.test.ts \
  tests/unit/session-keepalive-approval.test.ts \
  tests/unit/otel-trace-serialization.test.ts \
  tests/unit/otel-trace-target-attribution.test.ts
```

## Full validation

Run from `services/runner`:

```bash
pnpm run typecheck
pnpm run test:unit
pnpm run build:extension
```

The focused review-fix suite passed 152 tests. The full implementation run passed
138 unit files: 2,282 tests passed and 7 existing tests remained marked as
expected failures. Typecheck and the extension build also passed.

## Live acceptance

Drive `/services/agent/v0/invoke` once with `pi_core` and `sandbox=local`, then
once with `pi_core` and `sandbox=daytona`. For each run:

1. Capture the `messageMetadata.traceId` from the SSE stream.
2. Find one `stage=pi_trace_spool_export` runner log with the matching trace
   suffix, the expected placement, `outcome=exported`, and `status=200`.
3. Fetch `/api/tracing/traces/{trace_id}` with a key for the same project.
4. Confirm the stored trace contains Pi-native span names such as `pi`, `chat`,
   `invoke_agent`, and `turn 0`, with parent IDs forming one connected tree.

The final local run persisted the native tree at:

- `b88610d6d07d49db6a41bc3ab505096e`

The final Daytona run persisted native trees at:

- `6f7ab273e8e0a22ff8c04d1e5c67ff5f`
- `ee9acd9a22bb1f3f9b73b9029f2ac92c`

A funded OpenAI run also completed at
`f9728271e297986eb805b8bcd67f2388`. Its root, `invoke_agent`, turn, and chat
spans each carry the same `$0.0023065` cumulative total, while only the actual
model-bearing spans carry it incrementally. This proves the runner export and
the stored cost roll-up agree without double-counting.

The release gate passed P2 and P2b on the local sandbox and P3 on Daytona. The
