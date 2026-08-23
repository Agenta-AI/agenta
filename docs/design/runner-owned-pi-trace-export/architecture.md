# Architecture

## Ownership model

| Responsibility | Owner |
|---|---|
| Observe Pi lifecycle events | Pi extension |
| Build Pi-native spans | Pi extension |
| Decide trace parent and capture policy for a turn | SDK and runner request |
| Move span bytes out of the harness | Runtime telemetry spool |
| Hold export endpoint and credentials | Runner |
| Renew platform credentials | Runner credential lease |
| Send OTLP over HTTP | Runner trace export sink |
| Authorize and ingest spans | Agenta API |

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

It does not contain an endpoint, authorization header, project credential, or token expiry.

### PiFileSpanExporter

The Pi extension keeps `createAgentaOtel` and all existing lifecycle hooks. Its batch transport
changes from HTTP to file publication.

At `agent_end` it:

1. ends the Pi spans through the existing tracer;
2. gathers the run into one batch through the existing trace batch processor;
3. serializes the batch as an OTLP `ExportTraceServiceRequest` protobuf;
4. enforces the configured maximum batch size;
5. writes `<channelId>.otlp.pb.tmp.<nonce>`;
6. renames it atomically to `<channelId>.otlp.pb`.

There is no custom span DTO and no JSON or base64 wrapping.

### PiTraceSpoolConsumer

The runner starts one consumer before it publishes the control file and before it sends the prompt.
The consumer uses the same implementation for both placements and receives a `RuntimeFileHost`.

It:

- sweeps stale telemetry files before the control file becomes visible;
- accepts only the current random channel filename;
- bounds directory entries, checks the stat size before reading, and gives the host the same
  maximum for its growth-safe read;
- deletes the final file immediately after pickup;
- retains the bytes in runner memory while export is in flight;
- forwards the exact protobuf bytes to the runner trace export sink;
- stops after one accepted batch or a bounded post-prompt drain timeout.

The channel ID prevents a stale warm-turn file from being attributed to the next turn. It is a
correlation value, not a secret or an authorization mechanism.

### Live platform authorization

The runner already owns a mutable credential getter refreshed by the session alive watchdog.
PR #6217 makes trace export call that getter immediately before export instead of capturing its
initial value. The Pi spool uses the same getter. This fixes long turns without adding a second
lease, a new refresh protocol, or a 401-specific retry path.

For a third-party OTLP endpoint, use the configured static exporter header and do not call Agenta's
permission exchange. This preserves current collector support.

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
  traceId?: string;
  turnId?: string;
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
emitSpans: !plan.isPi
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

Parsing and enforcing every span's trace ID in the runner is optional hardening, not a prerequisite
for removing the credential. If implemented, it must use standard generated OTLP types and preserve
the original bytes for forwarding. Do not build a second semantic span validator in the runner.

## Failure behavior

| Failure | Behavior |
|---|---|
| Control file cannot be published | Log `stage=pi_trace_control`; Pi tracing stays disabled; emit one runner fallback span; do not fail the turn. |
| Pi cannot serialize or publish | Log in Pi; the drain reports `stage=pi_trace_spool_missing`; emit one runner fallback span; do not fail the turn. |
| Prompt is cancelled or throws | End Pi's lifecycle first so `agent_end` can publish the complete trace it currently holds, then drain. If no valid batch arrives, emit one runner fallback span carrying the run error and resolved usage. |
| File is too large | Reject and delete it; log bounded metadata; do not send it. |
| Stale or wrong channel file | Ignore or sweep it; never associate it with the current turn. |
| Filesystem watch fails | Fall back to bounded polling. |
| Daytona filesystem call fails transiently | Retry within the existing bounded poll/drain rules. |
| Credential rotates during a turn | The session watchdog refreshes it; export resolves the current getter value. |
| Agenta returns 401 | Record the failed export through existing bounded diagnostics; this change adds no 401 refresh-and-retry protocol. |
| OTLP endpoint times out or returns non-success | Log export diagnostics; return the successful agent result. |
| Runner stops after pickup | Batch is lost in the first release because the queue is not durable. This is explicit and measurable. |

Do not add periodic partial batches. Pi publishes one complete lifecycle batch when `agent_end`
runs. The fallback callback is idempotent, so teardown cannot create a second fallback. Splitting a
turn into checkpoints would break ingest-time cumulative usage rollups.

Diagnostics must include stage, placement, source, turn ID, trace ID suffix, batch bytes, pickup
latency, export latency, HTTP status, and credential age. They must not include the token, protobuf
body, prompt, or captured span content.

