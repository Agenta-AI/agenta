# Architecture

## Ownership model

| Responsibility                                    | Owner                    |
| ------------------------------------------------- | ------------------------ |
| Observe Pi lifecycle events                       | Pi extension             |
| Build Pi-native spans                             | Pi extension             |
| Decide trace parent and capture policy for a turn | SDK and runner request   |
| Move span bytes out of the harness                | Runtime telemetry spool  |
| Hold export endpoint and credentials              | Runner                   |
| Renew platform credentials                        | Runner credential lease  |
| Send OTLP over HTTP                               | Runner trace export sink |
| Authorize and ingest spans                        | Agenta API               |

The important boundary is between producing telemetry and exporting telemetry. Pi is a producer,
not a network client of Agenta.

## Components to add

### TelemetryFileHost

Add a byte-oriented host dedicated to telemetry. Do not refactor the tool relay:

```ts
interface TelemetryFileHost {
  list(dir: string, maxEntries: number): Promise<string[]>;
  statSize(path: string): Promise<number | undefined>;
  readBytes(path: string, maxBytes: number): Promise<Uint8Array>;
  writeBytes(path: string, contents: Uint8Array | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}
```

Provide local and Daytona implementations. The consumer rejects an oversized stat before reading,
then passes the same byte cap into `readBytes` to close the growth-after-stat race. The local host
opens without following symlinks, checks the opened file, and allocates at most the cap plus one
byte. The Daytona host bounds the sandbox command output before base64 decoding and checks the
decoded length again. A sandbox-controlled file therefore cannot force an unbounded runner
allocation.

### Runtime IPC directories

Give each acquired environment an ephemeral runtime IPC root outside the durable cwd mount:

```text
<runtimeIpcDir>/
  tools/
  telemetry/
```

The tool subdirectory can be migrated from the current `relayDir` without changing its protocol.
The telemetry subdirectory is always created for Pi tracing, even when no tools are configured.
The root is stable for the warm environment; every turn uses a fresh random channel ID.

### PiTurnTraceControl

Before the prompt starts, the runner atomically publishes a small control file at a stable path.
Pi reads and deletes it during `before_agent_start`.

The file contains only values Pi needs to create correct spans:

- protocol version;
- random channel ID;
- turn ID and session ID when present;
- `traceparent` and `baggage`;
- content-capture policy;
- loaded skill names when they can vary by turn.
- bounded known-secret values already visible in the sandbox, used only to construct Pi's
  mandatory per-turn redactor.

It does not contain an endpoint, authorization header, project credential, or token expiry.

### PiFileSpanExporter

The Pi extension keeps `createAgentaOtel` and all existing lifecycle hooks. Its batch transport
changes from HTTP to file publication.

For every completed processor flush it:

1. receives a parent-first complete batch from the existing trace batch processor;
2. serializes that batch as an OTLP `ExportTraceServiceRequest` protobuf;
3. enforces the configured maximum batch size and four-file turn limit;
4. writes `<channelId>.<sequence>.otlp.pb.tmp.<nonce>`;
5. renames it atomically to `<channelId>.<sequence>.otlp.pb`;
6. advances the zero-based sequence only after publication succeeds.

`agent_end` ends the remaining Pi spans and triggers the final flush.

There is no custom span DTO and no JSON or base64 wrapping.

### PiTraceSpoolConsumer

The runner starts one consumer before it publishes the control file and before it sends the prompt.
The consumer uses the same implementation for both placements and receives a `RuntimeFileHost`.

It:

- sweeps stale telemetry files before the control file becomes visible;
- accepts only canonical `<channelId>.<sequence>.otlp.pb` files for the current random channel
  and sorts unseen sequences numerically;
- bounds directory entries, checks the stat size before reading, and gives the host the same
  maximum for its growth-safe read;
- deletes the final file immediately after pickup;
- retains the bytes in runner memory while export is in flight;
- forwards the exact protobuf bytes to the runner trace export sink;
- accepts at most four complete batches, deletes each on pickup, and stops at that limit or the
  bounded post-prompt drain timeout.

The channel ID prevents a stale warm-turn file from being attributed to the next turn. It is a
correlation value, not a secret or an authorization mechanism.

### Live platform authorization

PR #6217 makes trace export read a mutable credential getter immediately before sending. One
reusable platform credential lease now owns that getter: the session alive watchdog holds it for
session-owned turns, while `runTurn` holds it for standalone turns. Both proactively re-mint the
credential through the existing permission check, so one 12-hour turn and a 12-hour warm session
use the same path without adding a trace-specific lease or 401 retry.

Target classification happens before creating the lease. For a third-party OTLP endpoint, the
configured exporter header remains static and never enters Agenta's permission exchange or session
API headers. The legacy wire cannot carry separate platform and collector credentials; a
session-owned external-collector request therefore receives no platform credential until the
follow-up wire cleanup adds `platform.headers.authorization`.

### Raw-byte export path

Keep the existing runner span exporter. Add a thin `exportOtlpBytes` path for already serialized
Pi batches. It accepts raw bytes plus the same runner-owned target and diagnostics context:

```ts
interface OtlpBytesExportRequest {
  body: Uint8Array;
  target: {
    endpoint: string;
    authorization: () => string | undefined;
  };
  diagnostics: OtlpBytesExportDiagnostics;
}
```

It preserves the existing timeout, retry classification, missing-credential behavior, target
isolation, and bounded diagnostics. Runner-native spans keep their current exporter and avoid the
filesystem.

## Per-turn sequence

```mermaid
sequenceDiagram
    participant SDK
    participant Runner
    participant Host as RuntimeFileHost
    participant Pi
    participant API as OTLP ingest

    SDK->>Runner: /run with propagation, policy, endpoint, general credential
    Runner->>Runner: retain live authorization getter and export target
    Runner->>Host: start consumer and sweep stale files
    Runner->>Host: atomically publish current.control.json
    Runner->>Pi: prompt
    Pi->>Host: read and delete control file
    Pi->>Pi: create native spans from Pi events
    Pi->>Host: write temp OTLP protobuf
    Pi->>Host: rename to channelId.otlp.pb
    Runner->>Host: read and delete final file
    Runner->>Runner: resolve current authorization
    Runner->>API: POST exact protobuf bytes
    API-->>Runner: 200 or error
    Runner->>Runner: bounded drain, diagnostics, finish turn export
```

The sequence is identical for local and Daytona. Only the `RuntimeFileHost` implementation changes.

## Runner tracer behavior

Change Pi handling from placement-dependent to harness-dependent:

```ts
emitSpans: !plan.isPi;
```

The runner and Pi extension are one versioned artifact: the runner bundles and installs its own
extension into both local and Daytona environments. The cutover is therefore atomic; there is no
supported new-runner/old-extension pairing to negotiate and no feature flag.

For Pi, `createSandboxAgentOtel` continues to collect streamed output, events, stop reason, and
fallback error information, but it does not synthesize agent, turn, LLM, or tool spans from ACP.
For every other harness, current ACP tracing remains unchanged.

If the runner needs to emit a transport or runner error span, it can send that runner-owned span
through the same `RunnerTraceExportSink`. It must not replace or duplicate Pi's native span tree.

## Security boundary

The telemetry directory is sandbox-writable. A harness can forge a file, so the runner must treat
the spool as an untrusted producer.

The runner limits the authority of that producer structurally:

- Pi never sees a platform or exporter credential.
- Pi never chooses the endpoint. The runner uses the endpoint from the trusted run request.
- The runner accepts only the current random channel while that turn is active.
- The runner accepts at most the configured number of files and bytes.
- The runner sends only an OTLP protobuf body with a fixed content type and method.
- The runner never turns spool contents into arbitrary headers, URLs, or platform calls.
- The API still parses the protobuf, authorizes the caller, and applies ingest validation.

This is a bounded trace-ingest capability proxy. It exposes less authority than placing even a
trace-scoped bearer inside the harness because the bearer cannot be copied or replayed elsewhere.

The first release deliberately does not decode or bind span trace IDs in the runner. Any process
inside the sandbox that learns the current random channel can publish valid OTLP with arbitrary
trace IDs and attributes. The runner will forward those bytes under the caller's project-scoped
credential, so malicious sandbox code can add or replace matching spans inside that caller project.
It cannot choose another project, endpoint, header, method, or unbounded payload. The API enforces
project authorization and protobuf validity, but it does not prove that Pi performed redaction or
that every span belongs to the current turn.

This accepted tradeoff keeps Pi responsible for span semantics and avoids a second protobuf parser.
If threat review later requires trace binding, use standard generated OTLP types and preserve the
original bytes for forwarding; do not invent a custom span DTO or semantic validator.

## Failure behavior

| Failure                                        | Behavior                                                                                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control file cannot be published               | Log `stage=pi_trace_control`; Pi tracing stays disabled; emit one runner fallback span; do not fail the turn.                                                                                              |
| Pi cannot serialize or publish                 | Log in Pi; the drain reports `stage=pi_trace_spool_missing`; emit one runner fallback span; do not fail the turn.                                                                                          |
| Prompt is cancelled or throws                  | End Pi's lifecycle first so `agent_end` can publish the complete trace it currently holds, then drain. If no valid batch arrives, emit one runner fallback span carrying the run error and resolved usage. |
| File is too large                              | Reject and delete it; log bounded metadata; do not send it.                                                                                                                                                |
| Stale or wrong channel file                    | Ignore or sweep it; never associate it with the current turn.                                                                                                                                              |
| Filesystem watch fails                         | Fall back to bounded polling.                                                                                                                                                                              |
| Daytona filesystem call fails transiently      | Retry within the existing bounded poll/drain rules.                                                                                                                                                        |
| Credential rotates during a turn               | The shared platform lease refreshes it for session-owned and standalone turns; export resolves the current getter value.                                                                                   |
| Agenta returns 401                             | Record the failed export through existing bounded diagnostics; this change adds no 401 refresh-and-retry protocol.                                                                                         |
| OTLP endpoint times out or returns non-success | Log export diagnostics; return the successful agent result.                                                                                                                                                |
| Runner stops after pickup                      | Batch is lost in the first release because the queue is not durable. This is explicit and measurable.                                                                                                      |

Do not add periodic partial snapshots. Pi may publish a bounded sequence of complete processor
flushes, with `agent_end` producing the final batch. The fallback callback is idempotent and runs
only when no valid batch was accepted. Ingest recomputes cumulative metrics over the stored trace
after every batch, so split delivery does not lose root aggregation.

Diagnostics must include stage, placement, source, turn ID, trace ID suffix, batch bytes, pickup
latency, export latency, HTTP status, and credential age. They must not include the token, protobuf
body, prompt, or captured span content.

### HarnessTracePort

Generic turn orchestration depends on one narrow harness tracing port:

- the default adapter keeps runner-created spans for ordinary harnesses;
- the Pi adapter owns native-span control publication, spool finalization, cancellation, trace ID,
  and missing-batch fallback;
- `runTurn` invokes the same `start`, `finish`, and cancellation lifecycle without knowing
  channel filenames, file hosts, or Pi control fields.

This is a trace-ownership port, not a general harness plugin framework. A future harness that owns
native spans can add an adapter without adding another harness branch to generic turn orchestration.
