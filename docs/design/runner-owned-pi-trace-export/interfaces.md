# Interfaces

## Field classification

| Value                               | Semantic role          | Owner               | Changes               | Destination                       |
| ----------------------------------- | ---------------------- | ------------------- | --------------------- | --------------------------------- |
| `traceparent`                       | Protocol context       | Calling trace       | Every turn            | Pi control file and runner tracer |
| `baggage`                           | Protocol context       | Calling trace       | Every turn            | Pi control file and runner tracer |
| content capture                     | Policy                 | Operator or service | May change every turn | Pi control file and runner tracer |
| OTLP endpoint                       | Exporter configuration | Operator or SDK     | May change every turn | Runner only                       |
| general platform authorization      | Credential             | Access system       | Rotates during a turn | Agenta platform calls only        |
| third-party collector authorization | Exporter credential    | Operator or SDK     | Static for the run    | That collector's requests only    |
| channel ID                          | Transport correlation  | Runner              | Every turn            | Runner and Pi spool filenames     |
| OTLP protobuf body                  | Telemetry data         | Pi tracer           | Every completed flush | Pi spool to runner export sink    |
| session ID and turn ID              | Runtime metadata       | Runner request      | Per session and turn  | Control file and diagnostics      |

This classification is the reason `exportAuthorization` is unnecessary. The runner already owns a
renewable general platform credential. Pi needs telemetry data and protocol context, not a
credential.

## External `/run` wire

### Required contract for the feature

The runner needs these logical inputs:

```json
{
  "context": {
    "propagation": {
      "traceparent": "00-...-...-01",
      "baggage": "..."
    }
  },
  "telemetry": {
    "capture": {
      "content": { "enabled": true }
    },
    "exporters": {
      "otlp": {
        "endpoint": "https://example/api/otlp/v1/traces",
        "headers": {
          "authorization": "Secret ..."
        }
      }
    }
  }
}
```

No new field is needed to ship runner-owned export. The existing `headers.authorization` remains
the compatibility source for the runner's general credential during the first implementation.
The runner must resolve it once into its shared current-authorization provider; tracing and
session code consume that provider instead of repeatedly reading the telemetry DTO.

Do not add:

- `telemetry_credentials` to middleware state;
- `TraceContext.export_authorization`;
- `WireOtlpExporter.exportAuthorization`;
- an OTLP-only token scope;
- a fixed export-token TTL.

### Follow-up contract cleanup

The current general credential is semantically misplaced under the OTLP exporter even though many
runner platform calls use it. Clean that separately after the runner-owned exporter is stable.

Proposed canonical shape:

```json
{
  "platform": {
    "headers": {
      "authorization": "Secret ..."
    }
  },
  "context": {
    "propagation": {
      "traceparent": "00-...-...-01",
      "baggage": "..."
    }
  },
  "telemetry": {
    "capture": {
      "content": { "enabled": true }
    },
    "exporters": {
      "otlp": {
        "endpoint": "https://example/api/otlp/v1/traces"
      }
    }
  }
}
```

`platform.headers.authorization` is a credential under the platform it authenticates.
`telemetry.exporters.otlp.endpoint` remains exporter configuration. There is no exporter credential
on the normal Agenta path because the runner derives export authorization from its platform lease.

For a third-party collector that requires its own static header, keep that header under the OTLP
exporter. Its credential source is static and non-renewable, distinct from the Agenta platform
lease.

Migration should be explicit:

1. Runner reads `platform.headers.authorization` first and falls back to the legacy OTLP header.
2. SDK emits both fields during the compatibility window if old runners must remain supported.
3. Golden wire tests pin both the compatibility phase and final removal.
4. Remove the legacy general credential from telemetry only after the minimum supported runner
   version accepts `platform`.

## Pi control file

Stable path supplied once through the Pi process environment:

```text
AGENTA_AGENT_TELEMETRY_CONTROL_PATH=<runtimeIpcDir>/telemetry/current.control.json
```

Version 1 body:

```json
{
  "version": 1,
  "channelId": "f3e7d4...",
  "turnId": "019...",
  "sessionId": "019...",
  "propagation": {
    "traceparent": "00-...-...-01",
    "baggage": "..."
  },
  "capture": {
    "content": true
  },
  "skills": ["_agenta.default"],
  "redaction": {
    "knownValues": ["<sandbox-visible secret value>"]
  }
}
```

Rules:

- Runner writes a temporary sibling and atomically renames it to the stable path.
- Pi reads and deletes the stable file in `before_agent_start`.
- Pi rejects unknown versions and malformed channel IDs.
- Missing optional fields mean the same defaults as today.
- The file contains no endpoint or credential.
- `redaction.knownValues` contains only model environment values and both mount credential triples
  that are already visible to the sandbox. Pi reads them once to build its mandatory per-turn
  deny-set; they are never interpreted as export authorization.
- The collection is bounded and malformed or excess values are discarded by the parser.
- The runner keeps its authoritative copy in memory. It never trusts the file on return.

## Pi OTLP spool

Final filename:

```text
<runtimeIpcDir>/telemetry/<channelId>.<sequence>.otlp.pb
```

Publication:

```text
write <channelId>.<sequence>.otlp.pb.tmp.<nonce>
rename to <channelId>.<sequence>.otlp.pb
```

Payload:

- raw OTLP `ExportTraceServiceRequest` protobuf bytes;
- content type fixed by the runner to `application/x-protobuf`;
- one complete OTLP export request per completed processor flush;
- zero-based canonical decimal sequence numbers, bounded to four files in version 1;
- no JSON envelope, base64 encoding, header map, endpoint, or credential.

Pi publishes at most four files per turn. If a fifth or later processor flush completes, Pi drops
that body, logs `reason=file_limit`, leaves the four published files unchanged, and does not advance
the sequence.

Consumer rules:

- Start and finish are scoped to one turn.
- Accept only canonical final filenames for the expected channel and sequence.
- Sort unseen sequences before pickup and accept at most four files per turn.
- Mirror the API's configured maximum batch size, with an absolute runner safety ceiling.
- Delete on pickup and keep bytes in memory for the bounded export attempt.
- Remember accepted sequence numbers so a repeated listing cannot forward one file twice.
- Collect all bounded files available in the drain window before starting network sends.
- Count a non-empty canonical file within the size limit as structurally accepted after pickup. The
  runner does not decode its protobuf body.
- Count a batch as exported only after the collector returns success.
- Trigger the runner fallback only when the turn has zero structurally accepted batches. A
  canonical malformed protobuf can therefore be picked up, rejected by ingest, and diagnosed
  without producing a fallback span.
- Sweep final and temporary telemetry files before publishing the next control file.

## Internal credential interface

```ts
type AuthorizationProvider = () => string | undefined;
```

Properties:

- initialized from the credential on the current request;
- refreshed by one reusable platform credential lease while any Agenta turn is active;
- owned by the alive watchdog for session-owned turns and by `runTurn` for standalone turns;
- read immediately before every runner or Pi-spool export;
- created only after target classification;
- kept static for third-party collector authorization, which never enters Agenta's permission
  exchange;
- value and raw JWT claims never logged.

Do not create a second trace-specific lease or refresh channel.

## Internal export interface

```ts
interface OtlpBytesExportRequest {
  body: Uint8Array;
  target: {
    endpoint: string;
    authorization: AuthorizationProvider;
  };
  diagnostics: OtlpBytesExportDiagnostics;
}
```

`OtlpBytesExportDiagnostics` owns `traceId`, optional `turnId`, source, placement, byte count,
and redactors; those identifiers are diagnostic attribution, not separate top-level request
fields. `exportOtlpBytes()` makes one best-effort request and resolves after success, failure, or
timeout. It preserves existing classification and diagnostics behavior and does not throw into
agent execution.

## Compatibility rules

- A runner without the new spool path continues current behavior.
- The runner bundles and installs its matching Pi extension in both placements, so the runner,
  extension, and control protocol cut over atomically in one image release.
- Do not add a feature flag or support a mixed new-runner/old-extension mode.
- Direct Pi network export and runner spool export never run together.
- Runner logs identify `source=pi-spool` or `source=runner-acp` so duplicate paths are visible.
